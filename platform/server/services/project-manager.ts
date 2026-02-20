import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getDb, schema } from '~~/server/db'
import type { Project } from '~~/shared/types/project'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Row <-> Project mapping
// ---------------------------------------------------------------------------

type ProjectRow = typeof schema.projects.$inferSelect

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Verify that a directory exists and is a git repository.
 * Uses execFile for safety (no shell interpolation).
 */
async function assertGitRepo(dir: string): Promise<void> {
  const absDir = resolve(dir)

  // Check directory exists
  try {
    await access(absDir)
  }
  catch {
    throw new Error(`Path does not exist: ${absDir}`)
  }

  // Check it's a git repo
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: absDir })
  }
  catch {
    throw new Error(`Not a git repository: ${absDir}`)
  }
}

/**
 * Find the git toplevel (root) for a given directory.
 * Returns the absolute path to the repo root.
 */
async function gitToplevel(dir: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['rev-parse', '--show-toplevel'],
    { cwd: dir },
  )
  return stdout.trim()
}

// ---------------------------------------------------------------------------
// Settings key for active project
// ---------------------------------------------------------------------------

const ACTIVE_PROJECT_KEY = 'activeProjectId'

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type ProjectEventType = 'project:activated' | 'project:deactivated'

export interface ProjectEvent {
  type: ProjectEventType
  project: Project | null
  timestamp: number
}

export type ProjectEventHandler = (event: ProjectEvent) => void

// ---------------------------------------------------------------------------
// ProjectManager
// ---------------------------------------------------------------------------

export class ProjectManager {
  private listeners = new Set<ProjectEventHandler>()
  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /**
   * Register a new project directory.
   * Validates that the path exists and is a git repository.
   */
  async createProject(name: string, path: string): Promise<Project> {
    // Expand ~ to home directory (shell doesn't expand it in HTTP requests)
    const expanded = path.startsWith('~/')
      ? join(process.env.HOME ?? process.env.USERPROFILE ?? '', path.slice(1))
      : path
    const absPath = resolve(expanded)

    // Validate path is a git repo
    await assertGitRepo(absPath)

    const db = getDb()
    const now = Date.now()
    const id = nanoid()

    // Check for duplicate path
    const existing = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.path, absPath))
      .get()

    if (existing) {
      throw new Error(`Project already registered at path: ${absPath}`)
    }

    db.insert(schema.projects)
      .values({
        id,
        name,
        path: absPath,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return { id, name, path: absPath, createdAt: now, updatedAt: now }
  }

  /** Get a single project by ID. */
  getProject(id: string): Project | null {
    const db = getDb()
    const row = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get()

    return row ? rowToProject(row) : null
  }

  /** List all registered projects. */
  listProjects(): Project[] {
    const db = getDb()
    const rows = db
      .select()
      .from(schema.projects)
      .all()

    return rows.map(rowToProject)
  }

  /** Remove a project from the database. Does not delete files on disk. */
  removeProject(id: string): void {
    const db = getDb()
    const deleted = db
      .delete(schema.projects)
      .where(eq(schema.projects.id, id))
      .run()

    if (deleted.changes === 0) {
      throw new Error(`Project '${id}' not found`)
    }

    // If this was the active project, clear the setting
    const activeId = this._getActiveProjectId()
    if (activeId === id) {
      this._clearActiveProjectId()
    }
  }

  // -------------------------------------------------------------------------
  // Active project
  // -------------------------------------------------------------------------

  /** Get the currently active project, or null if none is set. */
  getActiveProject(): Project | null {
    const activeId = this._getActiveProjectId()
    if (!activeId) return null
    return this.getProject(activeId)
  }

  /** Set the active project by ID. Validates that the project exists. */
  setActiveProject(id: string): void {
    const project = this.getProject(id)
    if (!project) {
      throw new Error(`Project '${id}' not found`)
    }

    const db = getDb()
    const now = Date.now()

    const existing = db
      .select({ key: schema.settings.key })
      .from(schema.settings)
      .where(eq(schema.settings.key, ACTIVE_PROJECT_KEY))
      .get()

    if (existing) {
      db.update(schema.settings)
        .set({ value: JSON.stringify(id), updatedAt: now })
        .where(eq(schema.settings.key, ACTIVE_PROJECT_KEY))
        .run()
    }
    else {
      db.insert(schema.settings)
        .values({ key: ACTIVE_PROJECT_KEY, value: JSON.stringify(id), updatedAt: now })
        .run()
    }

    this.emit({ type: 'project:activated', project, timestamp: now })
  }

  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------

  /**
   * Detect a project from a working directory.
   * Finds the git root and checks if it matches a registered project.
   * Falls back to process.cwd() if no cwd is provided.
   */
  async detectProject(cwd?: string): Promise<Project | null> {
    const dir = cwd ?? process.cwd()

    let gitRoot: string
    try {
      gitRoot = await gitToplevel(dir)
    }
    catch {
      return null
    }

    const absRoot = resolve(gitRoot)
    const db = getDb()
    const row = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.path, absRoot))
      .get()

    return row ? rowToProject(row) : null
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /** Subscribe to project events. Returns an unsubscribe function. */
  on(handler: ProjectEventHandler): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  private emit(event: ProjectEvent): void {
    for (const handler of this.listeners) {
      try {
        handler(event)
      }
      catch {
        // Listener threw -- don't let it break other listeners
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private _getActiveProjectId(): string | null {
    const db = getDb()
    const row = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, ACTIVE_PROJECT_KEY))
      .get()

    if (!row) return null

    try {
      return JSON.parse(row.value) as string
    }
    catch {
      return null
    }
  }

  private _clearActiveProjectId(): void {
    const db = getDb()
    db.delete(schema.settings)
      .where(eq(schema.settings.key, ACTIVE_PROJECT_KEY))
      .run()

    this.emit({ type: 'project:deactivated', project: null, timestamp: Date.now() })
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ProjectManager | undefined

export function useProjectManager(): ProjectManager {
  if (!_instance) {
    _instance = new ProjectManager()
  }
  return _instance
}
