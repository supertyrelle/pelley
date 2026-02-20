import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, symlink, readlink, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { WorktreeInfo } from '~~/shared/types/worktree'

const execFileAsync = promisify(execFile)

/**
 * Sanitize a task slug into a valid git branch name segment.
 * Lowercase, replace non-alphanumeric with hyphens, collapse runs, trim, max 72 chars.
 */
function sanitizeBranchSegment(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72)
}

/**
 * Run a git command safely using execFile (no shell interpolation).
 * Returns { stdout, stderr }. Throws on non-zero exit with a descriptive error.
 */
async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, { cwd })
  }
  catch (err: unknown) {
    const e = err as { stderr?: string; code?: number; message?: string }
    const detail = e.stderr?.trim() || e.message || 'unknown git error'
    throw new Error(`git ${args[0]} failed: ${detail}`)
  }
}

/**
 * Per-project mutex: serializes worktree operations that touch the same
 * project to avoid concurrent `git worktree` calls racing each other.
 */
class ProjectMutex {
  private locks = new Map<string, Promise<void>>()

  async acquire(projectPath: string): Promise<() => void> {
    const key = resolve(projectPath)

    // Wait for any pending operation on this project
    while (this.locks.has(key)) {
      await this.locks.get(key)
    }

    let release!: () => void
    const promise = new Promise<void>((r) => {
      release = () => {
        this.locks.delete(key)
        r()
      }
    })
    this.locks.set(key, promise)
    return release
  }
}

// ---------------------------------------------------------------------------
// WorktreeManager
// ---------------------------------------------------------------------------

export class WorktreeManager {
  private mutex = new ProjectMutex()

  // -- public API -----------------------------------------------------------

  /**
   * Create a worktree for the given task.
   *
   * - Branch: `task/<sanitized-slug>`
   * - Path:   `<projectPath>/.worktrees/<sanitized-slug>`
   * - After creation, symlinks `node_modules` from the main worktree so
   *   dependency installs are not duplicated.
   */
  async createWorktree(
    projectPath: string,
    taskSlug: string,
  ): Promise<WorktreeInfo> {
    const release = await this.mutex.acquire(projectPath)
    try {
      return await this._createWorktree(projectPath, taskSlug)
    }
    finally {
      release()
    }
  }

  /**
   * Remove a worktree. Falls back to `--force` when a clean remove fails.
   * If the worktree branch is fully merged into HEAD it is also deleted.
   */
  async removeWorktree(worktreePath: string): Promise<void> {
    // Discover the main worktree so we can lock on its path
    const projectPath = await this._mainWorktreePath(worktreePath)
    const release = await this.mutex.acquire(projectPath)
    try {
      await this._removeWorktree(worktreePath, projectPath)
    }
    finally {
      release()
    }
  }

  /**
   * List every worktree associated with the project at `projectPath`.
   */
  async listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
    return this._parseWorktreeList(projectPath)
  }

  /**
   * Retrieve info for a single worktree, or `undefined` if it does not exist.
   */
  async getWorktree(worktreePath: string): Promise<WorktreeInfo | undefined> {
    const abs = resolve(worktreePath)
    try {
      const projectPath = await this._mainWorktreePath(worktreePath)
      const all = await this._parseWorktreeList(projectPath)
      return all.find((w) => resolve(w.path) === abs)
    }
    catch {
      return undefined
    }
  }

  // -- internals ------------------------------------------------------------

  private async _createWorktree(
    projectPath: string,
    taskSlug: string,
  ): Promise<WorktreeInfo> {
    const absProject = resolve(projectPath)
    await this._assertGitRepo(absProject)

    const segment = sanitizeBranchSegment(taskSlug)
    if (!segment) {
      throw new Error(`Invalid task slug: "${taskSlug}" produces empty branch name`)
    }

    const branchName = `task/${segment}`
    const worktreeDir = join(absProject, '.worktrees')
    const worktreePath = join(worktreeDir, segment)

    // Ensure .worktrees directory exists
    await mkdir(worktreeDir, { recursive: true })

    // Check that the branch does not already exist
    try {
      await git(['rev-parse', '--verify', branchName], absProject)
      throw new Error(`Branch "${branchName}" already exists`)
    }
    catch (err: unknown) {
      const msg = (err as Error).message
      // If rev-parse failed because branch doesn't exist, that's what we want
      if (msg.includes('already exists')) throw err
    }

    // Create the worktree with a new branch based on HEAD
    await git(
      ['worktree', 'add', '-b', branchName, worktreePath],
      absProject,
    )

    // Symlink shared directories to avoid duplicating heavy deps
    await this._symlinkSharedDirs(absProject, worktreePath)

    // Read HEAD commit of the new worktree
    const { stdout: headCommit } = await git(
      ['rev-parse', 'HEAD'],
      worktreePath,
    )

    return {
      path: worktreePath,
      branchName,
      headCommit: headCommit.trim(),
      isMain: false,
      taskSlug,
      createdAt: new Date(),
    }
  }

  private async _removeWorktree(
    worktreePath: string,
    projectPath: string,
  ): Promise<void> {
    const abs = resolve(worktreePath)

    // Determine the branch before removing the worktree
    let branchName: string | undefined
    try {
      const { stdout } = await git(
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        abs,
      )
      branchName = stdout.trim()
    }
    catch {
      // worktree may already be partially broken
    }

    // Attempt clean remove, fall back to --force
    try {
      await git(['worktree', 'remove', abs], projectPath)
    }
    catch {
      await git(['worktree', 'remove', '--force', abs], projectPath)
    }

    // Clean up the branch if fully merged
    if (branchName && branchName !== 'HEAD' && branchName.startsWith('task/')) {
      try {
        // --delete only succeeds if the branch is merged into HEAD
        await git(['branch', '--delete', branchName], projectPath)
      }
      catch {
        // Branch not fully merged -- leave it for the user
      }
    }

    // Remove the worktree directory if it lingers (e.g. symlinks left behind)
    try {
      await rm(abs, { recursive: true, force: true })
    }
    catch {
      // best-effort cleanup
    }
  }

  /**
   * Parse `git worktree list --porcelain` into WorktreeInfo[].
   *
   * Porcelain format emits blocks separated by blank lines:
   *   worktree /absolute/path
   *   HEAD <sha>
   *   branch refs/heads/<name>
   *   (optional: bare, detached, prunable)
   */
  private async _parseWorktreeList(projectPath: string): Promise<WorktreeInfo[]> {
    const absProject = resolve(projectPath)
    await this._assertGitRepo(absProject)

    const { stdout } = await git(['worktree', 'list', '--porcelain'], absProject)
    const entries: WorktreeInfo[] = []
    const blocks = stdout.split('\n\n').filter(Boolean)

    for (const block of blocks) {
      const lines = block.split('\n')
      let path = ''
      let headCommit = ''
      let branchName = ''
      let isBare = false

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.slice('worktree '.length)
        }
        else if (line.startsWith('HEAD ')) {
          headCommit = line.slice('HEAD '.length)
        }
        else if (line.startsWith('branch ')) {
          // refs/heads/task/foo -> task/foo
          branchName = line.slice('branch '.length).replace('refs/heads/', '')
        }
        else if (line === 'bare') {
          isBare = true
        }
        else if (line === 'detached') {
          branchName = '(detached)'
        }
      }

      if (!path) continue
      if (isBare) continue

      const isMain = resolve(path) === absProject
      const taskSlug = branchName.startsWith('task/')
        ? branchName.slice('task/'.length)
        : undefined

      entries.push({
        path,
        branchName,
        headCommit,
        isMain,
        taskSlug,
      })
    }

    return entries
  }

  /**
   * Symlink directories that should be shared between main and worktree.
   * Currently: node_modules. Silently skips if the source doesn't exist.
   */
  private async _symlinkSharedDirs(
    mainPath: string,
    worktreePath: string,
  ): Promise<void> {
    const sharedDirs = ['node_modules']

    for (const dir of sharedDirs) {
      const source = join(mainPath, dir)
      const target = join(worktreePath, dir)

      // Only symlink if the source exists and the target doesn't
      try {
        await access(source)
      }
      catch {
        continue // source doesn't exist, skip
      }

      try {
        // Check if target already exists (as symlink or real dir)
        await readlink(target)
        continue // already a symlink
      }
      catch {
        // target doesn't exist or isn't a symlink -- proceed
      }

      try {
        await symlink(source, target, 'dir')
      }
      catch {
        // non-fatal: deps just won't be shared
      }
    }
  }

  /**
   * Resolve the main worktree path from any worktree path.
   * Uses `git worktree list --porcelain` and returns the first entry.
   */
  private async _mainWorktreePath(anyWorktreePath: string): Promise<string> {
    const { stdout } = await git(
      ['worktree', 'list', '--porcelain'],
      resolve(anyWorktreePath),
    )
    const firstLine = stdout.split('\n')[0]
    if (!firstLine?.startsWith('worktree ')) {
      throw new Error(`Cannot determine main worktree from: ${anyWorktreePath}`)
    }
    return firstLine.slice('worktree '.length)
  }

  private async _assertGitRepo(dir: string): Promise<void> {
    try {
      await git(['rev-parse', '--git-dir'], dir)
    }
    catch {
      throw new Error(`Not a git repository: ${dir}`)
    }
  }
}

/** Singleton instance shared across the server. */
export const worktreeManager = new WorktreeManager()
