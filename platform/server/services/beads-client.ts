import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Bead, BeadStats, BeadUpdate, EpicStatus } from '~~/shared/types/bead'

const execFileAsync = promisify(execFile)

// -------------------------------------------------------------------
// bd CLI JSON shape mapping
// -------------------------------------------------------------------

/** Raw shape returned by `bd list --json`, `bd show --json`, `bd ready --json` */
interface BdIssueLine {
  id: string
  title: string
  description?: string
  status: string
  priority?: number
  issue_type: string
  owner?: string
  assignee?: string
  created_at?: string
  updated_at?: string
  labels?: string[]
  dependencies?: {
    issue_id: string
    depends_on_id: string
    type: string
  }[]
  dependents?: {
    id: string
    title: string
    dependency_type: string
  }[]
}

/** Raw shape returned by `bd status --json` */
interface BdStatusResponse {
  summary: {
    total_issues: number
    open_issues: number
    in_progress_issues: number
    closed_issues: number
    blocked_issues: number
    deferred_issues: number
    ready_issues: number
  }
}

/** Raw shape returned by `bd epic status --json` */
interface BdEpicStatusLine {
  epic: {
    id: string
    title: string
    status: string
  }
  total_children: number
  closed_children: number
  eligible_for_close: boolean
}

// -------------------------------------------------------------------
// Mapping helpers
// -------------------------------------------------------------------

function mapBead(raw: BdIssueLine): Bead {
  // Extract blocked-by IDs from dependencies array
  const blockedBy: string[] = []
  if (raw.dependencies) {
    for (const dep of raw.dependencies) {
      if (dep.type === 'depends-on' || dep.type === 'parent-child') {
        blockedBy.push(dep.depends_on_id)
      }
    }
  }

  // Extract blocks IDs from dependents array
  const blocks: string[] = []
  if (raw.dependents) {
    for (const dep of raw.dependents) {
      if (dep.dependency_type === 'depends-on') {
        blocks.push(dep.id)
      }
    }
  }

  return {
    id: raw.id,
    title: raw.title,
    type: raw.issue_type as Bead['type'],
    status: normalizeStatus(raw.status),
    priority: raw.priority,
    description: raw.description,
    owner: raw.owner,
    assignee: raw.assignee,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    labels: raw.labels,
    blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
    blocks: blocks.length > 0 ? blocks : undefined,
  }
}

function normalizeStatus(status: string): Bead['status'] {
  const map: Record<string, Bead['status']> = {
    'open': 'open',
    'in_progress': 'in-progress',
    'in-progress': 'in-progress',
    'closed': 'closed',
    'blocked': 'blocked',
    'deferred': 'deferred',
  }
  return map[status] ?? 'open'
}

function mapEpicStatus(raw: BdEpicStatusLine): EpicStatus {
  const total = raw.total_children
  const closed = raw.closed_children
  const pct = total > 0 ? Math.round((closed / total) * 100) : 0

  return {
    id: raw.epic.id,
    title: raw.epic.title,
    status: raw.epic.status,
    completionPercent: pct,
    childrenTotal: total,
    childrenClosed: closed,
    eligibleForClose: raw.eligible_for_close,
  }
}

// -------------------------------------------------------------------
// BeadsClient
// -------------------------------------------------------------------

export class BeadsClient {
  private bdPath: string | null = null
  private available: boolean | null = null

  /**
   * Resolve the `bd` binary path once and cache it.
   * Throws a 503-style error if bd is not installed.
   */
  private async resolveBd(): Promise<string> {
    if (this.bdPath) return this.bdPath

    try {
      const { stdout } = await execFileAsync('which', ['bd'])
      this.bdPath = stdout.trim()
      this.available = true
      return this.bdPath
    }
    catch {
      this.available = false
      throw createError({
        statusCode: 503,
        statusMessage: 'bd CLI is not installed or not found in PATH',
      })
    }
  }

  /** Run `bd` with the given arguments and return stdout. */
  private async execBd(args: string[]): Promise<string> {
    const bin = await this.resolveBd()

    try {
      const { stdout } = await execFileAsync(bin, args, {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: resolveProjectRoot(),
      })
      return stdout
    }
    catch (err: unknown) {
      const error = err as { code?: number, stderr?: string, message?: string }

      // bd returns non-zero for "not found" style errors
      if (error.stderr?.includes('not found') || error.stderr?.includes('no issue')) {
        throw createError({
          statusCode: 404,
          statusMessage: error.stderr.trim(),
        })
      }

      throw createError({
        statusCode: 500,
        statusMessage: `bd command failed: ${error.stderr || error.message || 'unknown error'}`,
      })
    }
  }

  /** Parse JSON output from bd. */
  private parseJson<T>(raw: string): T {
    try {
      return JSON.parse(raw) as T
    }
    catch {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to parse bd JSON output',
      })
    }
  }

  // -----------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------

  /** Check if bd is available without throwing. */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available
    try {
      await this.resolveBd()
      return true
    }
    catch {
      return false
    }
  }

  /** List beads with optional filters. */
  async list(filters?: { status?: string, type?: string, parent?: string, limit?: number }): Promise<Bead[]> {
    const args = ['list', '--json', '--limit', '0']

    if (filters?.status) args.push('--status', filters.status)
    if (filters?.type) args.push('--type', filters.type)
    if (filters?.parent) args.push('--parent', filters.parent)
    if (filters?.limit) args.splice(args.indexOf('0'), 1, String(filters.limit))

    const raw = await this.execBd(args)
    const items = this.parseJson<BdIssueLine[]>(raw)
    return items.map(mapBead)
  }

  /** Show a single bead by ID. */
  async show(id: string): Promise<Bead> {
    const raw = await this.execBd(['show', id, '--json'])
    const items = this.parseJson<BdIssueLine[]>(raw)

    if (!items || items.length === 0) {
      throw createError({ statusCode: 404, statusMessage: `Bead '${id}' not found` })
    }

    return mapBead(items[0]!)
  }

  /** Create a new bead. */
  async create(options: {
    title: string
    type: string
    priority?: string
    parent?: string
    description?: string
  }): Promise<Bead> {
    const args = ['create', '--json', '--title', options.title, '--type', options.type]

    if (options.priority) args.push('--priority', options.priority)
    if (options.parent) args.push('--parent', options.parent)
    if (options.description) args.push('--description', options.description)

    const raw = await this.execBd(args)
    const created = this.parseJson<BdIssueLine>(raw)
    return mapBead(created)
  }

  /** Close a bead by ID. */
  async close(id: string, reason?: string): Promise<void> {
    const args = ['close', id, '--json']
    if (reason) args.push('--reason', reason)
    await this.execBd(args)
  }

  /** Update fields on an existing bead. */
  async update(id: string, fields: Partial<BeadUpdate>): Promise<void> {
    const args = ['update', id, '--json']

    if (fields.title) args.push('--title', fields.title)
    if (fields.priority) args.push('--priority', fields.priority)
    if (fields.description) args.push('--description', fields.description)
    if (fields.status) args.push('--status', fields.status)
    if (fields.assignee) args.push('--assignee', fields.assignee)

    await this.execBd(args)
  }

  /** Get backlog stats. */
  async stats(): Promise<BeadStats> {
    const raw = await this.execBd(['status', '--json'])
    const data = this.parseJson<BdStatusResponse>(raw)
    const s = data.summary

    return {
      total: s.total_issues,
      open: s.open_issues,
      closed: s.closed_issues,
      inProgress: s.in_progress_issues,
      blocked: s.blocked_issues,
      deferred: s.deferred_issues,
      ready: s.ready_issues,
    }
  }

  /** Available work -- open beads with no blockers. */
  async ready(): Promise<Bead[]> {
    const raw = await this.execBd(['ready', '--json'])
    const items = this.parseJson<BdIssueLine[]>(raw)
    return items.map(mapBead)
  }

  /** List children of a parent bead. */
  async children(parentId: string): Promise<Bead[]> {
    const raw = await this.execBd(['children', parentId, '--json'])
    const items = this.parseJson<BdIssueLine[]>(raw)
    return items.map(mapBead)
  }

  /** Add a dependency: fromId depends on toId. */
  async addDep(fromId: string, toId: string): Promise<void> {
    await this.execBd(['dep', 'add', fromId, toId])
  }

  /** Export database to JSONL (sync). */
  async sync(options?: { flushOnly?: boolean }): Promise<void> {
    const args = ['sync']
    if (options?.flushOnly) args.push('--flush-only')
    await this.execBd(args)
  }

  /** Epic completion status. */
  async epicStatus(): Promise<EpicStatus[]> {
    const raw = await this.execBd(['epic', 'status', '--json'])
    const items = this.parseJson<BdEpicStatusLine[]>(raw)
    return items.map(mapEpicStatus)
  }
}

// -------------------------------------------------------------------
// Singleton
// -------------------------------------------------------------------

let _instance: BeadsClient | undefined

export function useBeadsClient(): BeadsClient {
  if (!_instance) {
    _instance = new BeadsClient()
  }
  return _instance
}
