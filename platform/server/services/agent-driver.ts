import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type {
  AgentDriverEvent,
  AgentDriverSession as AgentDriverSessionInfo,
  TextDeltaEvent,
  ThinkingEvent,
  ToolCallStartEvent,
  ToolCallResultEvent,
  ApprovalRequestEvent,
  ApprovalResponseEvent,
  CompleteEvent,
  UsageEvent,
  ErrorEvent,
  ReadyEvent,
  UserMessageEvent,
} from '~~/shared/types/agent-driver'
import type { AgentConfig } from '~~/shared/types/agent'
import { INSTANCE_CAPABILITIES } from '~~/shared/types/agent'
import { useAgentRegistry, buildEnvForAgent, modelFlags } from './agent-registry'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = AgentDriverSessionInfo['status']
export type EventListener = (event: AgentDriverEvent) => void

export interface CreateSessionOptions {
  modelOverride?: { provider: string; model: string }
  cwd?: string
}

// ---------------------------------------------------------------------------
// AgentDriver interface — implemented by real SDK integrations (future)
// and by the mock driver (now)
// ---------------------------------------------------------------------------

export interface AgentDriver {
  start(session: AgentDriverSession): Promise<void>
  sendPrompt(message: string): AsyncGenerator<AgentDriverEvent>
  respondToApproval(requestId: string, approved: boolean): void
  cancel(): void
  destroy(): void
}

// ---------------------------------------------------------------------------
// AgentDriverSession — manages one agent session
// ---------------------------------------------------------------------------

export class AgentDriverSession {
  readonly id: string
  readonly agentId: string
  readonly agentConfig: AgentConfig
  readonly createdAt: Date
  readonly cwd?: string
  status: SessionStatus = 'starting'

  /** Buffer of all events for reconnect replay. */
  readonly events: AgentDriverEvent[] = []

  /** ID of the session this was branched from, if any. */
  readonly parentSessionId?: string
  /** Sequence number at which this branch diverged from the parent. */
  readonly branchPoint?: number

  private seq: number = 0
  private readonly eventListeners = new Set<EventListener>()
  private driver: AgentDriver

  constructor(
    id: string,
    agentConfig: AgentConfig,
    driver: AgentDriver,
    options?: { cwd?: string; branchFrom?: { parentSessionId: string; branchPoint: number; events: AgentDriverEvent[] } },
  ) {
    this.id = id
    this.agentId = agentConfig.id
    this.agentConfig = agentConfig
    this.createdAt = new Date()
    this.driver = driver
    this.cwd = options?.cwd

    if (options?.branchFrom) {
      this.parentSessionId = options.branchFrom.parentSessionId
      this.branchPoint = options.branchFrom.branchPoint
      // Copy events up to the branch point
      this.events = [...options.branchFrom.events]
      this.seq = this.events.length
    }
  }

  // -- Public API -----------------------------------------------------------

  /** Register a listener for events. Returns an unsubscribe function. */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /** Unregister an event listener. */
  offEvent(listener: EventListener): void {
    this.eventListeners.delete(listener)
  }

  /** Send a prompt to the agent. */
  async sendPrompt(message: string): Promise<void> {
    if (this.status === 'error') {
      throw new Error(`Cannot send prompt to session ${this.id}: status is ${this.status}`)
    }

    // Emit user message so it flows through SSE to the client
    this.emit({
      type: 'user-message',
      content: message,
      seq: 0,
      timestamp: 0,
    } as UserMessageEvent)

    this.status = 'running'

    try {
      for await (const event of this.driver.sendPrompt(message)) {
        this.emit(event)
      }
      // Transition back to idle after turn completes (enables multi-turn chat)
      this.status = 'idle'
      this.emit({ type: 'ready', seq: 0, timestamp: 0 } as ReadyEvent)
    }
    catch (err) {
      this.emit({
        type: 'error',
        message: (err as Error).message,
        fatal: true,
        seq: 0,
        timestamp: 0,
      })
      this.status = 'error'
    }
  }

  /** Respond to an approval request. */
  respondToApproval(requestId: string, approved: boolean, alwaysAllow?: boolean): void {
    if (this.status !== 'waiting-approval') {
      throw new Error(`Cannot respond to approval: session ${this.id} status is ${this.status}`)
    }

    // Emit the approval response event
    this.emit({
      type: 'approval-response',
      requestId,
      approved,
      alwaysAllow,
      seq: 0,
      timestamp: 0,
    })

    this.status = 'running'
    this.driver.respondToApproval(requestId, approved)
  }

  /** Cancel the current operation. */
  cancel(): void {
    if (this.status === 'complete' || this.status === 'error') return
    this.driver.cancel()
    this.status = 'complete'
  }

  /** Get session info for external consumption. */
  getInfo(): AgentDriverSessionInfo {
    return {
      id: this.id,
      agentId: this.agentId,
      status: this.status,
      createdAt: this.createdAt,
      modelConfig: this.agentConfig.modelConfig
        ? {
            provider: this.agentConfig.modelConfig.provider,
            model: this.agentConfig.modelConfig.model,
            apiBaseUrl: this.agentConfig.modelConfig.apiBaseUrl,
            apiKeyEnvVar: this.agentConfig.modelConfig.apiKeyEnvVar,
          }
        : { provider: this.agentConfig.instanceType, model: this.agentConfig.command },
      parentSessionId: this.parentSessionId,
      branchPoint: this.branchPoint,
    }
  }

  /**
   * Create a new session that shares events up to `fromSeq`, then diverges.
   * New events in the branch don't affect the parent, and vice versa.
   */
  branch(fromSeq: number): AgentDriverSession {
    if (fromSeq < 0 || fromSeq > this.events.length) {
      throw new Error(
        `Cannot branch at seq ${fromSeq}: session ${this.id} has ${this.events.length} events`,
      )
    }

    const branchId = crypto.randomUUID()
    const branchDriver: AgentDriver = new MockAgentDriver()
    const eventsUpToBranch = this.events.slice(0, fromSeq)

    const branched = new AgentDriverSession(branchId, this.agentConfig, branchDriver, {
      cwd: this.cwd,
      branchFrom: {
        parentSessionId: this.id,
        branchPoint: fromSeq,
        events: eventsUpToBranch,
      },
    })

    return branched
  }

  // -- Internal methods -----------------------------------------------------

  /** Emit an event: assign seq/timestamp, buffer it, notify listeners. */
  emit(event: AgentDriverEvent): void {
    event.seq = this.nextSeq()
    event.timestamp = Date.now()

    this.events.push(event)

    // Update status based on event type
    if (event.type === 'approval-request') {
      this.status = 'waiting-approval'
    }
    else if (event.type === 'ready') {
      this.status = 'idle'
    }
    else if (event.type === 'error' && (event as ErrorEvent).fatal) {
      this.status = 'error'
    }

    for (const listener of this.eventListeners) {
      try {
        listener(event)
      }
      catch {
        // Listener threw — don't let it break other listeners
      }
    }
  }

  /** Tear down the session. */
  _dispose(): void {
    this.driver.destroy()
    this.eventListeners.clear()
  }

  private nextSeq(): number {
    return this.seq++
  }
}

// ---------------------------------------------------------------------------
// MockAgentDriver — simulates agent events for development/testing
// ---------------------------------------------------------------------------

class MockAgentDriver implements AgentDriver {
  private cancelled = false
  private approvalResolve: ((approved: boolean) => void) | null = null
  private session: AgentDriverSession | null = null

  async start(session: AgentDriverSession): Promise<void> {
    this.session = session
    this.cancelled = false
  }

  async *sendPrompt(message: string): AsyncGenerator<AgentDriverEvent> {
    this.cancelled = false
    const base = { seq: 0, timestamp: 0 } // Session.emit will overwrite

    // Thinking phase — simulate extended thinking with start, deltas, and end
    yield {
      ...base,
      type: 'thinking',
      active: true,
      phase: 'reasoning',
    } as ThinkingEvent

    const thinkingChunks = [
      `Let me analyze this request: "${message}". `,
      'I need to consider the relevant files and their structure. ',
      'Looking at the dependencies and how they connect. ',
      'Planning the approach for making changes. ',
      'I think I have a good understanding now.',
    ]
    for (const chunk of thinkingChunks) {
      if (this.cancelled) return
      await this.delay(400)
      yield {
        ...base,
        type: 'thinking',
        active: true,
        content: chunk,
      } as ThinkingEvent
    }

    if (this.cancelled) return
    await this.delay(200)

    // End thinking
    yield {
      ...base,
      type: 'thinking',
      active: false,
    } as ThinkingEvent

    if (this.cancelled) return

    // Stream text deltas
    const chunks = [
      'I\'ll help you with that. ',
      'Let me look at the relevant files ',
      'and make the necessary changes.',
    ]
    for (const chunk of chunks) {
      if (this.cancelled) return
      yield { ...base, type: 'text-delta', content: chunk } as TextDeltaEvent
      await this.delay(50)
    }

    if (this.cancelled) return

    // Simulate a tool call
    const callId = crypto.randomUUID()
    yield {
      ...base,
      type: 'tool-call-start',
      callId,
      toolName: 'Read',
      input: { file_path: '/mock/example.ts' },
    } as ToolCallStartEvent

    await this.delay(300)
    if (this.cancelled) return

    yield {
      ...base,
      type: 'tool-call-result',
      callId,
      toolName: 'Read',
      output: '// mock file contents\nexport const example = true',
      duration: 280,
      status: 'success',
    } as ToolCallResultEvent

    if (this.cancelled) return

    // Simulate an approval request
    const requestId = crypto.randomUUID()
    yield {
      ...base,
      type: 'approval-request',
      requestId,
      action: 'Edit file',
      affectedFiles: ['/mock/example.ts'],
      toolName: 'Edit',
    } as ApprovalRequestEvent

    // Wait for approval response
    const approved = await this.waitForApproval()
    if (this.cancelled) return

    if (approved) {
      // More text after approval
      yield {
        ...base,
        type: 'text-delta',
        content: '\n\nChanges applied successfully.',
      } as TextDeltaEvent
      await this.delay(100)
    }
    else {
      yield {
        ...base,
        type: 'text-delta',
        content: '\n\nUnderstood, I won\'t make that change.',
      } as TextDeltaEvent
      await this.delay(100)
    }

    if (this.cancelled) return

    // Complete
    yield {
      ...base,
      type: 'complete',
      summary: `Processed prompt: "${message}"`,
      tokensUsed: { input: 1200, output: 450 },
    } as CompleteEvent
  }

  respondToApproval(requestId: string, approved: boolean): void {
    if (this.approvalResolve) {
      this.approvalResolve(approved)
      this.approvalResolve = null
    }
  }

  cancel(): void {
    this.cancelled = true
    // Resolve any pending approval so the generator can exit
    if (this.approvalResolve) {
      this.approvalResolve(false)
      this.approvalResolve = null
    }
  }

  destroy(): void {
    this.cancel()
    this.session = null
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  private waitForApproval(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.approvalResolve = resolve
    })
  }
}

// ---------------------------------------------------------------------------
// CliAgentDriver — spawns a real CLI process per prompt
// ---------------------------------------------------------------------------

/** Environment variables to strip so child agents don't detect nesting. */
const SANITIZE_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION',
  'CLAUDE_CODE_ENTRY',
  'CLAUDE_CODE_ENTRYPOINT',
  'TERM_PROGRAM',
]

class CliAgentDriver implements AgentDriver {
  private child: ChildProcess | null = null
  private killed = false
  private turnCount = 0
  /** CLI session ID captured from stream-json output, used to resume the correct session. */
  private cliSessionId: string | null = null
  private sawContentBlockDelta = false
  private currentBlockType: string | null = null
  private readonly config: AgentConfig
  private readonly cwd: string

  constructor(config: AgentConfig, cwd?: string) {
    this.config = config
    this.cwd = cwd ?? process.cwd()
  }

  async start(_session: AgentDriverSession): Promise<void> {
    // Nothing to do on start — we spawn per-prompt
  }

  async *sendPrompt(message: string): AsyncGenerator<AgentDriverEvent> {
    this.killed = false
    this.sawContentBlockDelta = false
    this.currentBlockType = null
    const base = { seq: 0, timestamp: 0 }
    const isClaudeCode = this.config.instanceType === 'claude-code'

    // Build args
    const args: string[] = []

    // Resume the specific CLI session on subsequent turns
    if (this.turnCount > 0 && this.cliSessionId) {
      args.push('--resume', this.cliSessionId)
    }
    else if (this.turnCount > 0) {
      // Fallback: no captured session ID, use --continue (resumes most recent in cwd)
      const caps = INSTANCE_CAPABILITIES[this.config.instanceType]
      if (caps.continueFlag) args.push(caps.continueFlag)
    }

    if (isClaudeCode) {
      args.push('--print', '--verbose', '--output-format', 'stream-json', '-p', message, ...modelFlags(this.config))
    }
    else {
      args.push('-p', message, ...modelFlags(this.config))
    }

    // Build environment
    const env: Record<string, string> = { ...process.env } as Record<string, string>
    for (const key of SANITIZE_ENV_KEYS) {
      delete env[key]
    }
    Object.assign(env, buildEnvForAgent(this.config))

    // Spawn the process
    let child: ChildProcess
    try {
      child = spawn(this.config.command, args, {
        cwd: this.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }
    catch (err) {
      yield {
        ...base,
        type: 'error',
        message: `Failed to spawn ${this.config.command}: ${(err as Error).message}`,
        fatal: true,
      } as ErrorEvent
      return
    }

    this.child = child
    let stderr = ''

    // Collect stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    if (isClaudeCode) {
      yield* this.parseClaudeCodeStream(child, base, () => stderr)
    }
    else {
      yield* this.parsePlainStream(child, base, () => stderr)
    }

    this.turnCount++
    this.child = null
  }

  respondToApproval(_requestId: string, _approved: boolean): void {
    // Claude Code in --print mode doesn't do interactive approvals
  }

  cancel(): void {
    this.killed = true
    if (this.child) {
      this.child.kill('SIGTERM')
      // Force kill after 3 seconds if still alive
      const child = this.child
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        }
        catch {
          // Already dead
        }
      }, 3000)
    }
  }

  destroy(): void {
    this.cancel()
    this.child = null
  }

  // -- Stream parsers -------------------------------------------------------

  private async *parseClaudeCodeStream(
    child: ChildProcess,
    base: { seq: number; timestamp: number },
    getStderr: () => string,
  ): AsyncGenerator<AgentDriverEvent> {
    // Use readline to process stdout line by line
    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity })

    // We need to consume readline as an async iterator and also wait for
    // the process exit. Use a shared event queue to merge both sources.
    const queue: Array<{ type: 'line'; data: string } | { type: 'close' } | { type: 'exit'; code: number | null }> = []
    let resolve: (() => void) | null = null

    const push = (item: typeof queue[number]) => {
      queue.push(item)
      if (resolve) {
        resolve()
        resolve = null
      }
    }

    rl.on('line', line => push({ type: 'line', data: line }))
    rl.on('close', () => push({ type: 'close' }))
    child.on('exit', (code) => push({ type: 'exit', code }))
    child.on('error', (err) => push({ type: 'exit', code: 1 }))

    let done = false
    let exitCode: number | null = null
    let sawClose = false
    let sawExit = false
    let sawResult = false

    while (!done && !this.killed) {
      // Drain all queued items
      while (queue.length > 0) {
        const item = queue.shift()!

        if (item.type === 'line') {
          const line = item.data.trim()
          if (!line) continue

          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(line)
          }
          catch {
            // Non-JSON line — emit as text
            yield { ...base, type: 'text-delta', content: line + '\n' } as TextDeltaEvent
            continue
          }

          // Capture CLI session ID from stream-json for --resume on subsequent turns
          if (!this.cliSessionId && typeof parsed.session_id === 'string') {
            this.cliSessionId = parsed.session_id
          }

          const evt = this.mapClaudeEvent(parsed, base)
          if (evt) {
            if (evt.type === 'complete') sawResult = true
            yield evt
          }
        }
        else if (item.type === 'close') {
          sawClose = true
        }
        else if (item.type === 'exit') {
          exitCode = item.code
          sawExit = true
        }

        if (sawClose && sawExit) {
          done = true
          break
        }
      }

      if (!done && !this.killed) {
        // Wait for more items
        await new Promise<void>(r => { resolve = r })
      }
    }

    // Emit error if process exited non-zero without a result event
    if (exitCode !== null && exitCode !== 0 && !sawResult) {
      const errMsg = getStderr().trim()
      yield {
        ...base,
        type: 'error',
        message: errMsg || `Process exited with code ${exitCode}`,
        fatal: true,
      } as ErrorEvent
    }

    // Emit complete if we didn't get one from the stream
    if (!sawResult && !this.killed) {
      yield { ...base, type: 'complete' } as CompleteEvent
    }
  }

  private async *parsePlainStream(
    child: ChildProcess,
    base: { seq: number; timestamp: number },
    getStderr: () => string,
  ): AsyncGenerator<AgentDriverEvent> {
    // For non-claude-code agents, just stream stdout as text
    const queue: Array<{ type: 'data'; data: string } | { type: 'exit'; code: number | null }> = []
    let resolve: (() => void) | null = null

    const push = (item: typeof queue[number]) => {
      queue.push(item)
      if (resolve) {
        resolve()
        resolve = null
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => push({ type: 'data', data: chunk.toString() }))
    child.on('exit', (code) => push({ type: 'exit', code }))
    child.on('error', () => push({ type: 'exit', code: 1 }))

    let done = false
    let exitCode: number | null = null

    while (!done && !this.killed) {
      while (queue.length > 0) {
        const item = queue.shift()!

        if (item.type === 'data') {
          yield { ...base, type: 'text-delta', content: item.data } as TextDeltaEvent
        }
        else if (item.type === 'exit') {
          exitCode = item.code
          done = true
          break
        }
      }

      if (!done && !this.killed) {
        await new Promise<void>(r => { resolve = r })
      }
    }

    if (exitCode !== null && exitCode !== 0) {
      const errMsg = getStderr().trim()
      yield {
        ...base,
        type: 'error',
        message: errMsg || `Process exited with code ${exitCode}`,
        fatal: true,
      } as ErrorEvent
    }

    yield { ...base, type: 'complete' } as CompleteEvent
  }

  // -- Claude Code event mapping --------------------------------------------

  private mapClaudeEvent(
    parsed: Record<string, unknown>,
    base: { seq: number; timestamp: number },
  ): AgentDriverEvent | null {
    const type = parsed.type as string | undefined
    if (!type) return null

    switch (type) {
      case 'content_block_delta': {
        const delta = parsed.delta as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          this.sawContentBlockDelta = true
          return { ...base, type: 'text-delta', content: delta.text } as TextDeltaEvent
        }
        if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          return { ...base, type: 'thinking', active: true, content: delta.thinking } as ThinkingEvent
        }
        return null
      }

      case 'content_block_start': {
        const block = parsed.content_block as Record<string, unknown> | undefined
        if (block?.type === 'thinking') {
          this.currentBlockType = 'thinking'
          return { ...base, type: 'thinking', active: true, phase: 'reasoning' } as ThinkingEvent
        }
        if (block?.type === 'tool_use') {
          this.currentBlockType = 'tool_use'
          return {
            ...base,
            type: 'tool-call-start',
            callId: (block.id as string) ?? crypto.randomUUID(),
            toolName: (block.name as string) ?? 'unknown',
            input: (block.input as Record<string, unknown>) ?? {},
          } as ToolCallStartEvent
        }
        this.currentBlockType = block?.type as string ?? null
        return null
      }

      case 'tool_result':
      case 'subagent': {
        // tool_result events from Claude Code stream-json
        return {
          ...base,
          type: 'tool-call-result',
          callId: (parsed.tool_use_id as string) ?? (parsed.id as string) ?? crypto.randomUUID(),
          toolName: (parsed.name as string) ?? (parsed.tool_name as string) ?? 'unknown',
          output: typeof parsed.content === 'string'
            ? parsed.content
            : typeof parsed.output === 'string'
              ? parsed.output
              : JSON.stringify(parsed.content ?? parsed.output ?? ''),
          duration: 0,
          status: (parsed.is_error || parsed.error) ? 'error' as const : 'success' as const,
        } as ToolCallResultEvent
      }

      case 'result': {
        // result can be a string (--print mode) or an object
        const rawResult = parsed.result
        const result = typeof rawResult === 'object' && rawResult !== null
          ? rawResult as Record<string, unknown>
          : undefined
        const resultText = typeof rawResult === 'string'
          ? rawResult
          : typeof result?.text === 'string'
            ? result.text as string
            : undefined
        const usage = (parsed.usage ?? result?.usage) as Record<string, number> | undefined
        return {
          ...base,
          type: 'complete',
          summary: resultText,
          tokensUsed: usage
            ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 }
            : undefined,
        } as CompleteEvent
      }

      case 'assistant': {
        // In --print mode, content_block_delta events are not emitted.
        // With stream-json, content_block_delta already delivered the text incrementally.
        if (this.sawContentBlockDelta) return null
        // Extract text directly from the assistant message envelope.
        const msg = parsed.message as Record<string, unknown> | undefined
        if (msg?.content && Array.isArray(msg.content)) {
          const textParts = (msg.content as Array<Record<string, unknown>>)
            .filter(b => b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text as string)
          if (textParts.length > 0) {
            return { ...base, type: 'text-delta', content: textParts.join('') } as TextDeltaEvent
          }
        }
        return null
      }

      case 'message_delta': {
        const usage = parsed.usage as Record<string, number> | undefined
        if (usage && (usage.input_tokens || usage.output_tokens)) {
          return {
            ...base,
            type: 'usage',
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
          } as UsageEvent
        }
        return null
      }

      case 'content_block_stop': {
        const wasThinking = this.currentBlockType === 'thinking'
        this.currentBlockType = null
        if (wasThinking) {
          return { ...base, type: 'thinking', active: false } as ThinkingEvent
        }
        return null
      }

      case 'system':
      case 'message_start':
      case 'message_stop':
      case 'ping':
        // Informational — skip
        return null

      default:
        // Unknown event type — skip silently for resilience
        return null
    }
  }
}

// ---------------------------------------------------------------------------
// AgentDriverManager singleton — manages all sessions
// ---------------------------------------------------------------------------

class AgentDriverManager {
  private sessions = new Map<string, AgentDriverSession>()

  /** Create a new agent driver session. */
  async createSession(agentId: string, options?: CreateSessionOptions): Promise<AgentDriverSession> {
    const registry = useAgentRegistry()
    await registry.init()
    const agentConfig = registry.get(agentId)
    if (!agentConfig) {
      throw new Error(`Unknown agent: "${agentId}"`)
    }

    // Apply model override if provided
    const config = options?.modelOverride
      ? {
          ...agentConfig,
          modelConfig: {
            ...agentConfig.modelConfig,
            provider: options.modelOverride.provider,
            model: options.modelOverride.model,
          },
        }
      : agentConfig

    const sessionId = crypto.randomUUID()

    // Select driver: real CLI for agents with a command, mock for custom/unconfigured
    let driver: AgentDriver
    if (config.instanceType === 'custom' || !config.command) {
      driver = new MockAgentDriver()
    }
    else {
      driver = new CliAgentDriver(config, options?.cwd)
    }

    const session = new AgentDriverSession(sessionId, config, driver, { cwd: options?.cwd })
    this.sessions.set(sessionId, session)

    // Start the driver
    await driver.start(session)
    session.emit({ type: 'ready', seq: 0, timestamp: 0 } as ReadyEvent)

    return session
  }

  /** Retrieve an existing session by ID. */
  getSession(sessionId: string): AgentDriverSession | undefined {
    return this.sessions.get(sessionId)
  }

  /** List all sessions with their current status. */
  listSessions(): AgentDriverSessionInfo[] {
    return Array.from(this.sessions.values()).map(s => s.getInfo())
  }

  /** Create a branch from an existing session at a specific sequence number. */
  branchSession(sessionId: string, fromSeq: number): AgentDriverSession {
    const parent = this.sessions.get(sessionId)
    if (!parent) {
      throw new Error(`Unknown session: "${sessionId}"`)
    }

    const branched = parent.branch(fromSeq)
    this.sessions.set(branched.id, branched)

    // Start the branch driver so it's ready for prompts
    branched.status = 'running'

    return branched
  }

  /** Get all sessions that were branched from a given session. */
  getBranches(sessionId: string): AgentDriverSessionInfo[] {
    const branches: AgentDriverSessionInfo[] = []
    for (const session of this.sessions.values()) {
      if (session.parentSessionId === sessionId) {
        branches.push(session.getInfo())
      }
    }
    return branches
  }

  /** Destroy a session and clean up resources. */
  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.cancel()
    session._dispose()
    this.sessions.delete(sessionId)
  }

  /** Destroy all sessions. Call on server shutdown. */
  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroySession(id)
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

let _instance: AgentDriverManager | undefined

export function useAgentDriverManager(): AgentDriverManager {
  if (!_instance) {
    _instance = new AgentDriverManager()
  }
  return _instance
}
