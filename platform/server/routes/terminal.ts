import { defineEventHandler } from 'h3'
import { eq } from 'drizzle-orm'
import { ptyManager } from '~~/server/services/pty-manager'
import { useAgentRegistry, buildEnvForAgent, modelFlags, prepareKimiConfig, prepareOpenCodeConfig } from '~~/server/services/agent-registry'
import { useModelRegistry } from '~~/server/services/model-registry'
import { useProjectManager } from '~~/server/services/project-manager'
import { getDb, schema } from '~~/server/db'
import { launchFlags } from '~~/shared/types/agent'
import type { AgentConfig, LaunchOptions } from '~~/shared/types/agent'
import type { Peer } from 'crossws'

// --------------------------------------------------------------------------
// Session tracking
// --------------------------------------------------------------------------

/** Map peer id -> PTY session id */
const peerSessions = new Map<string, string>()

/** Map peer id -> PTY listener unsubscribe functions (onOutput + onExit) */
const peerUnsubscribers = new Map<string, { output: () => void; exit: () => void }>()

/** Heartbeat state per peer */
const peerHeartbeats = new Map<string, { interval: ReturnType<typeof setInterval>, lastPong: number }>()

/** Pending kill timers for sessions whose last peer disconnected (grace period before PTY kill) */
const killTimers = new Map<string, NodeJS.Timeout>()

// --------------------------------------------------------------------------
// Query param helpers
// --------------------------------------------------------------------------

function parseQueryParams(url: string): Record<string, string> {
  try {
    const parsed = new URL(url, 'http://localhost')
    const params: Record<string, string> = {}
    for (const [key, value] of parsed.searchParams) {
      params[key] = value
    }
    return params
  }
  catch {
    return {}
  }
}

// --------------------------------------------------------------------------
// Launch options: parse from params with settings fallback
// --------------------------------------------------------------------------

function readLaunchDefaults(agentId: string): LaunchOptions {
  try {
    const db = getDb()
    const row = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, `agent-launch-defaults:${agentId}`))
      .get()
    if (row) return JSON.parse(row.value) as LaunchOptions
  }
  catch {
    // Settings unavailable or malformed -- use empty defaults
  }
  return {}
}

function resolveLaunchOptions(params: Record<string, string>, agentId: string): LaunchOptions {
  const defaults = readLaunchDefaults(agentId)
  return {
    sessionContinue: params.sessionContinue !== undefined
      ? params.sessionContinue === 'true'
      : defaults.sessionContinue,
    permissionSkip: params.permissionSkip !== undefined
      ? params.permissionSkip === 'true'
      : defaults.permissionSkip,
    modelOverride: params.modelProvider && params.modelName
      ? { provider: params.modelProvider, model: params.modelName }
      : defaults.modelOverride,
  }
}

function applyLaunchFlags(config: AgentConfig, options: LaunchOptions): AgentConfig {
  const extra = launchFlags(config.instanceType, options)
  if (extra.length === 0) return config
  return { ...config, args: [...config.args, ...extra] }
}

/** Append --model flags based on the final modelConfig (must be called AFTER modelOverride merge). */
function applyModelFlags(config: AgentConfig): AgentConfig {
  const extra = modelFlags(config)
  if (extra.length === 0) return config
  return { ...config, args: [...config.args, ...extra] }
}

// --------------------------------------------------------------------------
// Combined handler: GET returns health; Upgrade activates WebSocket
// --------------------------------------------------------------------------

export default defineEventHandler({
  handler() {
    // Non-upgrade GET requests hit this path -- return health info
    const sessions = ptyManager.list()
    const running = sessions.filter(s => s.status === 'running').length
    const stopped = sessions.filter(s => s.status === 'stopped' || s.status === 'error').length
    const health = ptyManager.checkHealth()
    return {
      status: 'ok',
      ptyHealthy: health.healthy,
      ptyError: health.error ?? null,
      activeSessions: running,
      stoppedSessions: stopped,
      totalTracked: sessions.length,
      connectedPeers: peerSessions.size,
    }
  },

  websocket: {
    async open(peer) {
      const params = parseQueryParams(peer.request?.url ?? '')
      const reconnectId = params.reconnect

      // -- Reconnect path -------------------------------------------------
      if (reconnectId) {
        const existing = ptyManager.get(reconnectId)
        if (!existing || existing.status === 'stopped' || existing.status === 'error') {
          peer.send(JSON.stringify({
            type: 'error',
            message: `Session ${reconnectId} not found or already terminated`,
            code: 4004,
          }))
          peer.close(4004, 'session not found')
          return
        }

        attachToPtySession(peer, existing)
        return
      }

      // -- Shared spawn params (used by both resume and new-session paths) --
      const cols = Number.parseInt(params.cols ?? '80', 10)
      const rows = Number.parseInt(params.rows ?? '24', 10)
      const cwd = params.cwd || useProjectManager().getActiveProject()?.path || process.cwd()

      // -- Resume path (agent restart with resume args) ---------------------
      const resumeAgentId = params.resume
      if (resumeAgentId) {
        const registry = useAgentRegistry()
        await registry.init()
        const agentConfig = registry.get(resumeAgentId)
        if (!agentConfig) {
          peer.send(JSON.stringify({ type: 'error', message: `Unknown agent: ${resumeAgentId}`, code: 4001 }))
          peer.close(4001, 'unknown agent')
          return
        }

        // Use resumeArgs if available, otherwise fall back to regular args
        const spawnArgs = agentConfig.resumeArgs ?? agentConfig.args
        const options = resolveLaunchOptions(params, resumeAgentId)
        let resumeConfig = applyLaunchFlags({ ...agentConfig, args: spawnArgs }, options)

        // Apply model override if specified
        if (options.modelOverride) {
          const contextWindow = useModelRegistry().getContextWindow(options.modelOverride.provider, options.modelOverride.model)
          resumeConfig = {
            ...resumeConfig,
            modelConfig: {
              ...resumeConfig.modelConfig,
              provider: options.modelOverride.provider,
              model: options.modelOverride.model,
              contextWindow,
            },
          }
        }

        // Add --model flags for CLIs that support them (after modelOverride is applied)
        resumeConfig = applyModelFlags(resumeConfig)

        // Ensure CLI configs have the selected model before spawn
        if (resumeConfig.modelConfig) {
          if (resumeConfig.instanceType === 'kimi-code') {
            await prepareKimiConfig(resumeConfig.modelConfig)
          }
          if (resumeConfig.instanceType === 'opencode') {
            await prepareOpenCodeConfig(resumeConfig.modelConfig)
          }
        }

        const health = ptyManager.checkHealth()
        if (!health.healthy) {
          peer.send(JSON.stringify({ type: 'error', message: `Terminal backend unavailable: ${health.error}`, code: 4003 }))
          peer.close(4003, 'pty unavailable')
          return
        }

        const env = buildEnvForAgent(resumeConfig)
        let session
        try {
          session = ptyManager.spawn(resumeConfig, { cols, rows, cwd, env })
        }
        catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          peer.send(JSON.stringify({ type: 'error', message: `Failed to spawn PTY: ${msg}`, code: 4002 }))
          peer.close(4002, 'spawn failed')
          return
        }

        peer.send(JSON.stringify({ type: 'session', sessionId: session.id }))
        attachToPtySession(peer, session)
        return
      }

      // -- New session path -----------------------------------------------
      const agentId = params.agentId
      if (!agentId) {
        peer.send(JSON.stringify({ type: 'error', message: 'Missing agentId query parameter', code: 4000 }))
        peer.close(4000, 'missing agentId')
        return
      }

      // Look up agent config
      const registry = useAgentRegistry()
      await registry.init()
      const agentConfig = registry.get(agentId)

      if (!agentConfig) {
        peer.send(JSON.stringify({ type: 'error', message: `Unknown agent: ${agentId}`, code: 4001 }))
        peer.close(4001, 'unknown agent')
        return
      }

      // Check PTY health before attempting spawn
      const health = ptyManager.checkHealth()
      if (!health.healthy) {
        peer.send(JSON.stringify({ type: 'error', message: `Terminal backend unavailable: ${health.error}`, code: 4003 }))
        peer.close(4003, 'pty unavailable')
        return
      }

      // Apply launch options (URL params override stored defaults)
      // sessionContinue only applies on resume — CLIs error if no prior session exists
      const options = resolveLaunchOptions(params, agentId)
      let finalConfig = applyLaunchFlags(agentConfig, { ...options, sessionContinue: false })

      // Apply model override if specified
      if (options.modelOverride) {
        const contextWindow = useModelRegistry().getContextWindow(options.modelOverride.provider, options.modelOverride.model)
        finalConfig = {
          ...finalConfig,
          modelConfig: {
            ...finalConfig.modelConfig,
            provider: options.modelOverride.provider,
            model: options.modelOverride.model,
            contextWindow,
          },
        }
      }

      // Add --model flags for CLIs that support them (after modelOverride is applied)
      finalConfig = applyModelFlags(finalConfig)

      // Ensure CLI configs have the selected model before spawn
      if (finalConfig.modelConfig) {
        if (finalConfig.instanceType === 'kimi-code') {
          await prepareKimiConfig(finalConfig.modelConfig)
        }
        if (finalConfig.instanceType === 'opencode') {
          await prepareOpenCodeConfig(finalConfig.modelConfig)
        }
      }

      // Build env vars and spawn PTY
      const env = buildEnvForAgent(finalConfig)
      let session
      try {
        session = ptyManager.spawn(finalConfig, { cols, rows, cwd, env })
      }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        peer.send(JSON.stringify({ type: 'error', message: `Failed to spawn PTY: ${msg}`, code: 4002 }))
        peer.close(4002, 'spawn failed')
        return
      }

      // Notify client of the assigned session ID (useful for reconnect)
      peer.send(JSON.stringify({ type: 'session', sessionId: session.id }))

      attachToPtySession(peer, session)
    },

    message(peer, message) {
      const sessionId = peerSessions.get(peer.id)
      if (!sessionId) return

      const session = ptyManager.get(sessionId)
      if (!session || session.status === 'stopped' || session.status === 'error') return

      // Try to parse as a JSON control message first.
      // If it fails or isn't a known control type, treat as terminal input.
      const text = message.text()
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object' && parsed.type === 'resize') {
          const cols = Number.parseInt(String(parsed.cols), 10)
          const rows = Number.parseInt(String(parsed.rows), 10)
          if (cols > 0 && rows > 0) {
            session.resize(cols, rows)
          }
          return
        }
        if (parsed && typeof parsed === 'object' && parsed.type === 'pong') {
          const hb = peerHeartbeats.get(peer.id)
          if (hb) {
            hb.lastPong = Date.now()
          }
          return
        }
        if (parsed && typeof parsed === 'object' && parsed.type === 'drain') {
          // Client reports it has consumed bytes -- flow control feedback
          const bytes = Number.parseInt(String(parsed.bytes), 10)
          if (bytes > 0) {
            session.consumerDrained(bytes)
          }
          return
        }
      }
      catch {
        // Not JSON -- fall through to treat as terminal input
      }

      // Forward raw input to PTY
      session.write(text)
    },

    close(peer) {
      cleanup(peer)
    },

    error(peer, error) {
      console.error(`[terminal] WebSocket error for peer ${peer.id}:`, error)
      cleanup(peer)
    },
  },
})

// --------------------------------------------------------------------------
// Attach a WebSocket peer to an existing PTY session
// --------------------------------------------------------------------------

function attachToPtySession(peer: Peer, session: ReturnType<typeof ptyManager.get> & {}) {
  // Cancel any pending kill timer for this session (peer reconnected during grace period)
  const pendingKill = killTimers.get(session.id)
  if (pendingKill) {
    clearTimeout(pendingKill)
    killTimers.delete(session.id)
  }

  peerSessions.set(peer.id, session.id)

  // Replay tail buffer so the client catches up (reconnect or first connect after spawn)
  const snapshot = session.getBufferedOutput()
  if (snapshot) {
    peer.send(snapshot)
  }

  // Forward PTY output to the WebSocket peer
  const unsubOutput = session.onOutput((data) => {
    try {
      peer.send(data)
    }
    catch {
      // Peer may have disconnected between output and send
    }
  })

  // Start heartbeat: ping every 30s, close if no pong within 60s
  const PING_INTERVAL_MS = 30_000
  const PONG_TIMEOUT_MS = 60_000
  const heartbeatNow = Date.now()
  const interval = setInterval(() => {
    const hb = peerHeartbeats.get(peer.id)
    if (!hb) return
    const elapsed = Date.now() - hb.lastPong
    if (elapsed > PONG_TIMEOUT_MS) {
      console.warn(`[terminal] Heartbeat timeout for peer ${peer.id} (${elapsed}ms since last pong)`)
      try { peer.close(4005, 'heartbeat timeout') } catch { /* already closed */ }
      cleanup(peer)
      return
    }
    try {
      peer.send(JSON.stringify({ type: 'ping' }))
    }
    catch {
      // Peer may have disconnected
    }
  }, PING_INTERVAL_MS)
  peerHeartbeats.set(peer.id, { interval, lastPong: heartbeatNow })

  // Forward PTY exit to the client
  const unsubExit = session.onExit((event) => {
    // Guard: only send if this peer is still attached
    if (!peerSessions.has(peer.id)) return
    peer.send(JSON.stringify({ type: 'exit', code: event.code, signal: event.signal }))
    try {
      peer.close(1000, 'pty exited')
    }
    catch {
      // Already closed
    }
  })

  peerUnsubscribers.set(peer.id, { output: unsubOutput, exit: unsubExit })
}

// --------------------------------------------------------------------------
// Cleanup: unsubscribe from PTY output, kill PTY if no peers remain
// --------------------------------------------------------------------------

function cleanup(peer: Peer) {
  const hb = peerHeartbeats.get(peer.id)
  if (hb) {
    clearInterval(hb.interval)
    peerHeartbeats.delete(peer.id)
  }

  const unsubs = peerUnsubscribers.get(peer.id)
  if (unsubs) {
    unsubs.output()
    unsubs.exit()
    peerUnsubscribers.delete(peer.id)
  }

  const sessionId = peerSessions.get(peer.id)
  if (sessionId) {
    peerSessions.delete(peer.id)

    // Kill PTY only if no other peers are attached to this session
    const otherPeersAttached = [...peerSessions.values()].some(id => id === sessionId)
    if (!otherPeersAttached) {
      // Grace period: wait 10s for reconnect before killing the PTY
      const timer = setTimeout(() => {
        killTimers.delete(sessionId)
        // Re-check in case a peer reconnected during the grace period
        const stillNoOne = ![...peerSessions.values()].some(id => id === sessionId)
        if (stillNoOne) {
          ptyManager.kill(sessionId)
        }
      }, 10_000)
      killTimers.set(sessionId, timer)
    }
  }
}
