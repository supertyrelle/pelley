import { eq } from 'drizzle-orm'
import { getDb, schema } from '~~/server/db'
import { useBeadsClient } from './beads-client'
import { useAgentRegistry, buildEnvForAgent } from './agent-registry'
import { worktreeManager } from './worktree-manager'
import { useContextManager } from './context-manager'
import { ptyManager } from './pty-manager'
import { useAgentDriverManager, type AgentDriverSession, type CreateSessionOptions } from './agent-driver'
import type { Task, CreateTaskOptions, TaskEvent, TaskEventType } from '~~/shared/types/task'

// ---------------------------------------------------------------------------
// Event system
// ---------------------------------------------------------------------------

type TaskEventHandler = (event: TaskEvent) => void

// ---------------------------------------------------------------------------
// Row <-> Task mapping
// ---------------------------------------------------------------------------

type TaskRow = typeof schema.tasks.$inferSelect

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    agentId: row.agentId,
    sessionId: row.sessionId ?? undefined,
    worktreePath: row.worktreePath ?? undefined,
    status: row.status as Task['status'],
    contextScope: row.contextScope as Task['contextScope'],
    projectPath: row.projectPath,
    useWorktree: row.useWorktree,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// TaskManager
// ---------------------------------------------------------------------------

export class TaskManager {
  /** In-memory cache keyed by task (bead) ID. */
  private tasks = new Map<string, Task>()

  /** Driver sessions keyed by task ID. */
  private driverSessions = new Map<string, AgentDriverSession>()

  /** Event listeners. */
  private listeners = new Set<TaskEventHandler>()

  private initialized = false

  // -----------------------------------------------------------------------
  // Initialization -- hydrate from database
  // -----------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    const db = getDb()
    const rows = db.select().from(schema.tasks).all()
    for (const row of rows) {
      const task = rowToTask(row)
      // Mark stale running tasks as failed on restart
      if (task.status === 'running') {
        task.status = 'failed'
        task.updatedAt = Date.now()
        db.update(schema.tasks)
          .set({ status: 'failed', updatedAt: task.updatedAt })
          .where(eq(schema.tasks.id, task.id))
          .run()
      }
      this.tasks.set(task.id, task)
    }
  }

  // -----------------------------------------------------------------------
  // Core lifecycle methods
  // -----------------------------------------------------------------------

  /**
   * Create a new task.
   * - Creates a bead in the backlog via the bd CLI.
   * - Optionally provisions a git worktree for isolated work.
   * - Persists the task to the database.
   */
  async createTask(options: CreateTaskOptions): Promise<Task> {
    await this.init()

    // Validate agent exists
    const registry = useAgentRegistry()
    await registry.init()
    const agent = registry.get(options.agentId)
    if (!agent) {
      throw createError({ statusCode: 400, statusMessage: `Unknown agent: ${options.agentId}` })
    }

    // Create the bead
    const beadsClient = useBeadsClient()
    const bead = await beadsClient.create({
      title: options.title,
      type: 'task',
    })

    const now = Date.now()
    const useWorktree = options.useWorktree ?? false
    const contextScope = options.contextScope ?? 'isolated'

    // Provision worktree if requested
    let worktreePath: string | undefined
    if (useWorktree) {
      try {
        const slug = bead.id.replace(/[^a-z0-9-]/gi, '-').slice(0, 40)
        const info = await worktreeManager.createWorktree(options.projectPath, slug)
        worktreePath = info.path
      }
      catch (err) {
        // Worktree creation failed -- still create the task but without worktree
        console.error(`[task-manager] Worktree creation failed for task ${bead.id}:`, err)
      }
    }

    const task: Task = {
      id: bead.id,
      title: options.title,
      agentId: options.agentId,
      sessionId: undefined,
      worktreePath,
      status: 'pending',
      contextScope,
      projectPath: options.projectPath,
      useWorktree,
      createdAt: now,
      updatedAt: now,
    }

    // Persist to database
    const db = getDb()
    db.insert(schema.tasks).values({
      id: task.id,
      title: task.title,
      agentId: task.agentId,
      sessionId: null,
      worktreePath: task.worktreePath ?? null,
      status: task.status,
      contextScope: task.contextScope,
      projectPath: task.projectPath,
      useWorktree: task.useWorktree,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }).run()

    // Cache in memory
    this.tasks.set(task.id, task)

    this.emit('task:created', task)
    return task
  }

  /**
   * Start a task by spawning a PTY session for the assigned agent.
   * Sets context scope and transitions status to 'running'.
   */
  async startTask(taskId: string): Promise<Task> {
    await this.init()

    const task = this.tasks.get(taskId)
    if (!task) {
      throw createError({ statusCode: 404, statusMessage: `Task not found: ${taskId}` })
    }
    if (task.status === 'running') {
      throw createError({ statusCode: 409, statusMessage: `Task ${taskId} is already running` })
    }
    if (task.status === 'completed' || task.status === 'failed') {
      throw createError({ statusCode: 409, statusMessage: `Task ${taskId} is already ${task.status}` })
    }

    // Resolve agent config
    const registry = useAgentRegistry()
    await registry.init()
    const agentConfig = registry.get(task.agentId)
    if (!agentConfig) {
      throw createError({ statusCode: 400, statusMessage: `Agent not found: ${task.agentId}` })
    }

    // Determine working directory -- worktree path if available, else project path
    const cwd = task.worktreePath ?? task.projectPath

    // Spawn PTY session
    const env = buildEnvForAgent(agentConfig)
    const session = ptyManager.spawn(agentConfig, {
      cols: 120,
      rows: 40,
      cwd,
      env,
    })

    // Set context scope
    const contextManager = useContextManager()
    contextManager.setScope(session.id, task.contextScope)

    // Register bead ownership so isolated sessions see their own beads
    contextManager.registerBead(task.id, session.id)

    // Update the bead status to in-progress
    try {
      const beadsClient = useBeadsClient()
      await beadsClient.update(task.id, { status: 'in_progress' })
    }
    catch {
      // Best-effort -- don't fail the start if bead update fails
    }

    // Listen for session exit to auto-update task status
    session.onExit((event) => {
      const current = this.tasks.get(taskId)
      if (!current || current.status !== 'running') return

      const newStatus = event.code === 0 ? 'completed' : 'failed'
      current.status = newStatus
      current.updatedAt = Date.now()

      this.persistUpdate(current)
      this.emit(newStatus === 'completed' ? 'task:stopped' : 'task:failed', current)
    })

    // Update task state
    task.sessionId = session.id
    task.status = 'running'
    task.updatedAt = Date.now()

    this.persistUpdate(task)
    this.emit('task:started', task)

    return task
  }

  /**
   * Stop a running task. Kills the PTY session and marks the task as failed.
   */
  async stopTask(taskId: string): Promise<void> {
    await this.init()

    const task = this.tasks.get(taskId)
    if (!task) {
      throw createError({ statusCode: 404, statusMessage: `Task not found: ${taskId}` })
    }
    if (task.status !== 'running') {
      throw createError({ statusCode: 409, statusMessage: `Task ${taskId} is not running (status: ${task.status})` })
    }

    // Kill the driver session if present, otherwise kill the PTY session
    const driverSession = this.driverSessions.get(taskId)
    if (driverSession) {
      useAgentDriverManager().destroySession(driverSession.id)
      this.driverSessions.delete(taskId)
    }
    else if (task.sessionId) {
      ptyManager.kill(task.sessionId)
      useContextManager().removeSession(task.sessionId)
    }

    task.status = 'failed'
    task.updatedAt = Date.now()

    this.persistUpdate(task)
    this.emit('task:stopped', task)
  }

  /**
   * Close a task. Closes the bead, removes the worktree if applicable,
   * and cleans up the session.
   */
  async closeTask(taskId: string): Promise<void> {
    await this.init()

    const task = this.tasks.get(taskId)
    if (!task) {
      throw createError({ statusCode: 404, statusMessage: `Task not found: ${taskId}` })
    }

    // Kill session if still running
    if (task.status === 'running') {
      const driverSession = this.driverSessions.get(taskId)
      if (driverSession) {
        useAgentDriverManager().destroySession(driverSession.id)
        this.driverSessions.delete(taskId)
      }
      else if (task.sessionId) {
        ptyManager.kill(task.sessionId)
        useContextManager().removeSession(task.sessionId)
      }
    }

    // Close the bead
    try {
      const beadsClient = useBeadsClient()
      await beadsClient.close(task.id)
    }
    catch {
      // Bead may already be closed or bd unavailable -- proceed with cleanup
    }

    // Remove worktree if one was created
    if (task.worktreePath) {
      try {
        await worktreeManager.removeWorktree(task.worktreePath)
      }
      catch (err) {
        console.error(`[task-manager] Worktree cleanup failed for task ${taskId}:`, err)
      }
    }

    // Mark as completed
    task.status = 'completed'
    task.sessionId = undefined
    task.updatedAt = Date.now()

    this.persistUpdate(task)
    this.emit('task:closed', task)
  }

  // -----------------------------------------------------------------------
  // Driver session support
  // -----------------------------------------------------------------------

  /**
   * Start a task using a driver session instead of a PTY session.
   * Creates an AgentDriverSession via useAgentDriverManager().
   */
  async startDriverTask(
    taskId: string,
    options?: CreateSessionOptions,
  ): Promise<Task> {
    await this.init()

    const task = this.tasks.get(taskId)
    if (!task) {
      throw createError({ statusCode: 404, statusMessage: `Task not found: ${taskId}` })
    }
    if (task.status === 'running') {
      throw createError({ statusCode: 409, statusMessage: `Task ${taskId} is already running` })
    }
    if (task.status === 'completed' || task.status === 'failed') {
      throw createError({ statusCode: 409, statusMessage: `Task ${taskId} is already ${task.status}` })
    }

    // Create a driver session
    const driverManager = useAgentDriverManager()
    const driverSession = await driverManager.createSession(task.agentId, options)

    // Store the driver session reference
    this.driverSessions.set(taskId, driverSession)

    // Listen for completion/error events to auto-update task status
    driverSession.onEvent((event) => {
      if (event.type === 'complete') {
        const current = this.tasks.get(taskId)
        if (!current || current.status !== 'running') return
        current.status = 'completed'
        current.updatedAt = Date.now()
        this.persistUpdate(current)
        this.emit('task:stopped', current)
      }
      else if (event.type === 'error' && 'fatal' in event && event.fatal) {
        const current = this.tasks.get(taskId)
        if (!current || current.status !== 'running') return
        current.status = 'failed'
        current.updatedAt = Date.now()
        this.persistUpdate(current)
        this.emit('task:failed', current)
      }
    })

    // Update the bead status to in-progress
    try {
      const beadsClient = useBeadsClient()
      await beadsClient.update(task.id, { status: 'in_progress' })
    }
    catch {
      // Best-effort
    }

    // Update task state — use driver session ID as the sessionId
    task.sessionId = driverSession.id
    task.status = 'running'
    task.updatedAt = Date.now()

    this.persistUpdate(task)
    this.emit('task:started', task)

    return task
  }

  /** Get the driver session for a task, if one exists. */
  getDriverSession(taskId: string): AgentDriverSession | undefined {
    return this.driverSessions.get(taskId)
  }

  /**
   * Get task status, including driver session status when applicable.
   * Returns both the task-level status and the driver session status if present.
   */
  getTaskStatus(taskId: string): { task: Task; driverStatus?: string } | undefined {
    const task = this.tasks.get(taskId)
    if (!task) return undefined

    const driverSession = this.driverSessions.get(taskId)
    return {
      task,
      driverStatus: driverSession?.status,
    }
  }

  // -----------------------------------------------------------------------
  // Query methods
  // -----------------------------------------------------------------------

  /** Get a single task by ID. */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId)
  }

  /** List tasks, optionally filtered by project path and/or status. */
  listTasks(filters?: { projectPath?: string, status?: Task['status'] }): Task[] {
    let result = Array.from(this.tasks.values())

    if (filters?.projectPath) {
      result = result.filter(t => t.projectPath === filters.projectPath)
    }
    if (filters?.status) {
      result = result.filter(t => t.status === filters.status)
    }

    // Sort by creation time, newest first
    return result.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Return only running tasks. */
  getActiveTasks(): Task[] {
    return this.listTasks({ status: 'running' })
  }

  // -----------------------------------------------------------------------
  // Event system
  // -----------------------------------------------------------------------

  /** Subscribe to task events. Returns an unsubscribe function. */
  on(handler: TaskEventHandler): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private emit(type: TaskEventType, task: Task): void {
    const event: TaskEvent = { type, task: { ...task }, timestamp: Date.now() }
    for (const handler of this.listeners) {
      try {
        handler(event)
      }
      catch {
        // Listener threw -- don't let it break other listeners
      }
    }
  }

  private persistUpdate(task: Task): void {
    const db = getDb()
    db.update(schema.tasks)
      .set({
        sessionId: task.sessionId ?? null,
        worktreePath: task.worktreePath ?? null,
        status: task.status,
        updatedAt: task.updatedAt,
      })
      .where(eq(schema.tasks.id, task.id))
      .run()
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: TaskManager | undefined

export function useTaskManager(): TaskManager {
  if (!_instance) {
    _instance = new TaskManager()
  }
  return _instance
}
