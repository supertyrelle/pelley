import { createRequire } from 'node:module'
import type { IPty } from 'node-pty'
import type { AgentConfig } from '~~/shared/types/agent'

const _require = createRequire(import.meta.url)

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type SessionStatus = 'starting' | 'running' | 'stopped' | 'error'

export interface PtyExitEvent {
  sessionId: string
  code: number
  signal?: number
}

export type OutputListener = (data: string) => void
export type ExitListener = (event: PtyExitEvent) => void

export interface SpawnOptions {
  cols: number
  rows: number
  cwd: string
  env?: Record<string, string>
}

// --------------------------------------------------------------------------
// Circular tail buffer -- keeps the last N lines for reconnect replay
// --------------------------------------------------------------------------

class TailBuffer {
  private buffer: string[]
  private head: number = 0
  private count: number = 0

  constructor(private readonly maxLines: number) {
    this.buffer = new Array<string>(maxLines)
  }

  push(line: string): void {
    this.buffer[this.head] = line
    this.head = (this.head + 1) % this.maxLines
    if (this.count < this.maxLines) this.count++
  }

  /** Append raw PTY output, splitting by newline. */
  append(data: string): void {
    const lines = data.split('\n')
    for (const line of lines) {
      this.push(line)
    }
  }

  /** Return buffered lines in order, oldest first. */
  getLines(): string[] {
    if (this.count === 0) return []
    if (this.count < this.maxLines) {
      return this.buffer.slice(0, this.count)
    }
    // Buffer is full -- head points to the oldest slot
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ]
  }

  /** Serialised snapshot suitable for sending to a reconnecting client. */
  getSnapshot(): string {
    return this.getLines().join('\n')
  }
}

// --------------------------------------------------------------------------
// PtySession -- wraps a single node-pty instance
// --------------------------------------------------------------------------

const BATCH_INTERVAL_MS = 8
const BATCH_SIZE_BYTES = 64 * 1024 // 64 KB
// Flow control thresholds.
// AI agent sessions routinely produce 50-100 KB per tool invocation (file
// dumps, search results, diffs).  A 256 KB ceiling caused frequent
// pause/resume cycles during bursts of tool output.  512 KB gives enough
// headroom for 3-5 back-to-back tool results before pausing, while still
// protecting against runaway output.  The low-water mark is set to 25% of
// high-water -- wide enough to avoid thrashing, narrow enough that the PTY
// resumes before the client starves for data.
const FLOW_HIGH_WATER = 512 * 1024 // 512 KB -- pause PTY
const FLOW_LOW_WATER = 128 * 1024 // 128 KB -- resume PTY

export class PtySession {
  readonly id: string
  readonly agentConfig: AgentConfig
  readonly pty: IPty
  status: SessionStatus = 'starting'
  readonly tailBuffer: TailBuffer

  // Listeners
  private readonly outputListeners = new Set<OutputListener>()
  private readonly exitListeners = new Set<ExitListener>()

  // Output batching state
  private batchBuffer: string = ''
  private batchTimer: ReturnType<typeof setTimeout> | null = null

  // Flow control
  private consumerBufferSize: number = 0
  private paused: boolean = false

  constructor(id: string, agentConfig: AgentConfig, pty: IPty) {
    this.id = id
    this.agentConfig = agentConfig
    this.pty = pty
    this.tailBuffer = new TailBuffer(5000)
  }

  // -- Public API -----------------------------------------------------------

  /** Send input to the PTY (keystrokes, paste, etc.). */
  write(data: string): void {
    if (this.status === 'stopped' || this.status === 'error') {
      throw new Error(`Cannot write to session ${this.id}: status is ${this.status}`)
    }
    try {
      this.pty.write(data)
    }
    catch (err) {
      // PTY may have died between our status check and the write call
      throw new Error(`Write to session ${this.id} failed: ${(err as Error).message}`)
    }
  }

  /** Resize the PTY dimensions. */
  resize(cols: number, rows: number): void {
    if (this.status === 'stopped' || this.status === 'error') return
    try {
      this.pty.resize(cols, rows)
    }
    catch {
      // Swallow -- PTY may have exited between check and call
    }
  }

  /** Kill the PTY process. */
  kill(): void {
    if (this.status === 'stopped' || this.status === 'error') return
    this.flushBatch()
    try {
      this.pty.kill()
    }
    catch {
      // Already dead -- that's fine
    }
  }

  /** Register a listener for batched output. Returns an unsubscribe function. */
  onOutput(listener: OutputListener): () => void {
    this.outputListeners.add(listener)
    return () => {
      this.outputListeners.delete(listener)
    }
  }

  /** Register a listener for exit events. Returns an unsubscribe function. */
  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  /** Return the tail buffer snapshot for reconnect replay. */
  getBufferedOutput(): string {
    return this.tailBuffer.getSnapshot()
  }

  /** Notify the session that a consumer has drained N bytes. */
  consumerDrained(bytes: number): void {
    this.consumerBufferSize = Math.max(0, this.consumerBufferSize - bytes)
    if (this.paused && this.consumerBufferSize < FLOW_LOW_WATER) {
      this.paused = false
      try {
        this.pty.resume?.()
      }
      catch {
        // Ignore -- PTY may be dead
      }
    }
  }

  // -- Internal methods (called by PtyManager) ------------------------------

  /** Wire up PTY data and exit handlers. Called once after construction. */
  _startListening(): void {
    this.pty.onData((data: string) => {
      this.tailBuffer.append(data)
      this.enqueueBatch(data)
    })

    this.pty.onExit(({ exitCode, signal }) => {
      this.flushBatch()
      this.clearBatchTimer()

      this.status = exitCode === 0 ? 'stopped' : 'error'

      const event: PtyExitEvent = {
        sessionId: this.id,
        code: exitCode,
        signal: signal ?? undefined,
      }
      for (const listener of this.exitListeners) {
        try {
          listener(event)
        }
        catch {
          // Listener threw -- don't let it break other listeners
        }
      }
    })

    this.status = 'running'
  }

  /** Tear down timers and listeners. Called by PtyManager on cleanup. */
  _dispose(): void {
    this.flushBatch()
    this.clearBatchTimer()
    this.outputListeners.clear()
    this.exitListeners.clear()
  }

  // -- Batching internals ---------------------------------------------------

  private enqueueBatch(data: string): void {
    this.batchBuffer += data

    // Flush immediately if size threshold exceeded
    if (Buffer.byteLength(this.batchBuffer) >= BATCH_SIZE_BYTES) {
      this.flushBatch()
      return
    }

    // Otherwise schedule a flush on the time threshold
    if (this.batchTimer === null) {
      this.batchTimer = setTimeout(() => {
        this.batchTimer = null
        this.flushBatch()
      }, BATCH_INTERVAL_MS)
    }
  }

  private flushBatch(): void {
    if (this.batchBuffer.length === 0) return

    const chunk = this.batchBuffer
    this.batchBuffer = ''
    this.clearBatchTimer()

    // Flow control: track consumer buffer size
    const chunkBytes = Buffer.byteLength(chunk)
    this.consumerBufferSize += chunkBytes

    if (this.consumerBufferSize > FLOW_HIGH_WATER && !this.paused) {
      this.paused = true
      try {
        this.pty.pause?.()
      }
      catch {
        // Ignore -- PTY may be dead
      }
    }

    for (const listener of this.outputListeners) {
      try {
        listener(chunk)
      }
      catch {
        // Listener threw -- don't let it break other listeners
      }
    }
  }

  private clearBatchTimer(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }
}

// --------------------------------------------------------------------------
// PtyManager singleton
// --------------------------------------------------------------------------

/** Environment variables to strip so child agents don't detect nesting. */
const SANITIZE_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION',
  'CLAUDE_CODE_ENTRY',
  'CLAUDE_CODE_ENTRYPOINT',
  'TERM_PROGRAM',
]

class PtyManager {
  private sessions = new Map<string, PtySession>()
  private ptyModule: typeof import('node-pty') | null = null
  private ptyError: string | null = null

  /** Try to load node-pty. Call once at startup. */
  checkHealth(): { healthy: boolean; error?: string } {
    if (this.ptyModule) return { healthy: true }
    if (this.ptyError) return { healthy: false, error: this.ptyError }
    try {
      this.ptyModule = _require('node-pty') as typeof import('node-pty')
      return { healthy: true }
    }
    catch (err) {
      this.ptyError = (err as Error).message
      return { healthy: false, error: this.ptyError }
    }
  }

  /** Spawn a new PTY session for the given agent config. */
  spawn(config: AgentConfig, options: SpawnOptions): PtySession {
    // Ensure node-pty is loaded
    if (!this.ptyModule) {
      const health = this.checkHealth()
      if (!health.healthy) {
        throw new Error(
          `node-pty is not available: ${health.error}. ` +
          `Ensure the native module is compiled for this platform.`,
        )
      }
    }
    const pty = this.ptyModule!

    const sessionId = crypto.randomUUID()

    // Build the environment: inherit process.env, strip nesting markers,
    // merge caller-supplied overrides, then apply model config.
    const env: Record<string, string> = { ...process.env } as Record<string, string>
    for (const key of SANITIZE_ENV_KEYS) {
      delete env[key]
    }
    if (options.env) {
      Object.assign(env, options.env)
    }
    if (config.modelConfig) {
      if (config.modelConfig.apiBaseUrl) {
        // Provider-agnostic convention: set both common env vars
        env.ANTHROPIC_BASE_URL = config.modelConfig.apiBaseUrl
        env.OPENAI_API_BASE = config.modelConfig.apiBaseUrl
      }
      if (config.modelConfig.model) {
        env.MODEL = config.modelConfig.model
      }
    }

    let ptyProcess: IPty
    try {
      ptyProcess = pty.spawn(config.command, config.args, {
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env,
      })
    }
    catch (err) {
      throw new Error(
        `Failed to spawn PTY for agent "${config.name}" ` +
        `(command: ${config.command}): ${(err as Error).message}`,
      )
    }

    const session = new PtySession(sessionId, config, ptyProcess)
    this.sessions.set(sessionId, session)

    // Wire up exit handler to auto-clean the map entry
    session.onExit(() => {
      // Keep session in map for status queries but stop tracking as "active"
      // Callers can still read tailBuffer for reconnect. A separate reap
      // could remove truly dead sessions later.
    })

    session._startListening()
    return session
  }

  /** Look up a session by ID. */
  get(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId)
  }

  /** Kill a specific session and remove it from the map. */
  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.kill()
    session._dispose()
    this.sessions.delete(sessionId)
  }

  /** Kill every active session. Call on server shutdown. */
  killAll(): void {
    for (const [id, session] of this.sessions) {
      session.kill()
      session._dispose()
      this.sessions.delete(id)
    }
  }

  /** Return all tracked sessions (including stopped ones still in map). */
  list(): PtySession[] {
    return Array.from(this.sessions.values())
  }
}

// --------------------------------------------------------------------------
// Singleton export
// --------------------------------------------------------------------------

export const ptyManager = new PtyManager()
