<script setup lang="ts">
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { LaunchOptions } from '~~/shared/types/agent'

const props = defineProps<{
  panelId: string
  agentId?: string
  sessionId?: string
  launchOptions?: LaunchOptions
}>()

const containerRef = ref<HTMLElement | null>(null)
const terminal = useTerminal()
const { setTerminalStatus, setTerminalActivity, updatePanel } = useTilingLayout()
const { activeTerminalPalette, getTerminalTheme, colorMode } = useTheme()

let xterm: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
let resizeRaf: number | null = null
let webglAddon: any = null
let webglRetries = 0
const MAX_WEBGL_RETRIES = 2
let dataUnsub: (() => void) | null = null
let exitUnsub: (() => void) | null = null

// Sync terminal status to shared panel state
watch(() => terminal.status.value, (s) => {
  setTerminalStatus(props.panelId, s)
})

// Persist sessionId to panel state so it survives page reloads
watch(() => terminal.sessionId.value, (sid) => {
  if (sid) {
    updatePanel(props.panelId, { sessionId: sid })
  }
})

// Apply terminal theme changes live (palette switch or color mode toggle)
watch([activeTerminalPalette, () => colorMode.value], () => {
  if (xterm) {
    xterm.options.theme = getTerminalTheme()
  }
})

// Scroll-to-bottom detection
const showScrollDown = ref(false)
let scrollCheckUnsub: (() => void) | null = null

// Sync idle state to shared panel state
watch(() => terminal.isIdle.value, (idle) => {
  setTerminalActivity(props.panelId, idle)
})

// Track the agentId we actually connected to, so we don't reconnect on every render
const connectedAgentId = ref<string | null>(null)

function createTerminal() {
  if (!containerRef.value) return
  if (xterm) return // already created

  xterm = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Cascadia Code", "Courier New", monospace',
    lineHeight: 1.2,
    scrollback: 10000,
    theme: getTerminalTheme(),
  })

  fitAddon = new FitAddon()
  xterm.loadAddon(fitAddon)
  xterm.loadAddon(new WebLinksAddon())

  // Try WebGL renderer, fall back silently if unavailable
  tryLoadWebGL(xterm)

  xterm.open(containerRef.value)

  // Fit once after open to get initial dimensions
  nextTick(() => {
    fitAddon?.fit()
  })

  // Forward keystrokes to the WebSocket
  xterm.onData((data) => {
    terminal.write(data)
  })

  // Receive data from the PTY
  dataUnsub = terminal.onData((data) => {
    xterm?.write(data)
  })

  // Handle PTY exit
  exitUnsub = terminal.onExit((_code, _signal) => {
    xterm?.write('\r\n\x1b[90m--- Process exited ---\x1b[0m\r\n')
  })

  // Watch for container resize (debounced via RAF to avoid thrashing during CSS transitions)
  resizeObserver = new ResizeObserver(() => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null
      if (!fitAddon || !xterm) return
      try {
        fitAddon.fit()
        terminal.resize(xterm.cols, xterm.rows)
      }
      catch {
        // fit() can throw if the element has zero dimensions during transitions
      }
    })
  })
  resizeObserver.observe(containerRef.value)

  // Track scroll position to show/hide scroll-to-bottom button
  const term = xterm
  function checkScrollPosition() {
    if (!term) return
    const buf = term.buffer.active
    const isAtBottom = buf.viewportY >= buf.baseY
    showScrollDown.value = !isAtBottom && buf.baseY > 0
  }

  // Check on new data
  const scrollDataUnsub = terminal.onData(() => {
    checkScrollPosition()
  })

  // Check on user scroll (xterm fires this event)
  const scrollDisposable = term.onScroll(() => {
    checkScrollPosition()
  })

  scrollCheckUnsub = () => {
    scrollDataUnsub()
    scrollDisposable.dispose()
  }
}

async function tryLoadWebGL(term: Terminal) {
  if (webglRetries >= MAX_WEBGL_RETRIES) return

  try {
    const { WebglAddon } = await import('@xterm/addon-webgl')
    const addon = new WebglAddon()

    addon.onContextLoss(() => {
      console.warn('[terminal] WebGL context lost, falling back to canvas')
      // Dispose the broken WebGL addon -- xterm falls back to canvas automatically
      try { addon.dispose() } catch { /* already disposed */ }
      webglAddon = null
      webglRetries++

      // Try to restore WebGL after a delay (browser may have freed resources)
      if (webglRetries < MAX_WEBGL_RETRIES) {
        setTimeout(() => tryLoadWebGL(term), 1000)
      }
    })

    term.loadAddon(addon)
    webglAddon = addon
  }
  catch {
    // WebGL not available -- the default canvas renderer is fine
    webglAddon = null
  }
}

function scrollToBottom() {
  if (xterm) {
    xterm.scrollToBottom()
    showScrollDown.value = false
  }
}

function connectToAgent(agentId: string, launchOptions?: LaunchOptions) {
  if (!xterm || !fitAddon) return

  // Fit first so we have accurate dimensions
  try {
    fitAddon.fit()
  }
  catch {
    // ignore
  }

  const cols = xterm.cols || 80
  const rows = xterm.rows || 24

  terminal.connect(agentId, { cols, rows, launchOptions })
  connectedAgentId.value = agentId
}

// Watch for agentId changes
watch(() => props.agentId, (newId) => {
  if (!newId) return
  if (newId === connectedAgentId.value) return

  // Disconnect old session if any
  if (connectedAgentId.value) {
    terminal.disconnect()
    xterm?.clear()
    connectedAgentId.value = null
  }

  if (xterm) {
    connectToAgent(newId, props.launchOptions)
  }
})

onMounted(() => {
  createTerminal()

  if (props.sessionId) {
    // Try reconnecting to an existing PTY session (survives page reload)
    nextTick(() => {
      terminal.reconnect(props.sessionId!)
      connectedAgentId.value = props.agentId ?? null
    })
  } else if (props.agentId) {
    // No prior session -- start fresh
    nextTick(() => {
      connectToAgent(props.agentId!, props.launchOptions)
    })
  }
})

// When a reconnect fails with 4004 (server restarted), clear stale session
// but don't auto-restart -- let the user click "Restart" to avoid loops
watch(() => terminal.sessionExpired.value, (expired) => {
  if (expired) {
    updatePanel(props.panelId, { sessionId: undefined })
  }
})

onUnmounted(() => {
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf)
    resizeRaf = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  scrollCheckUnsub?.()
  scrollCheckUnsub = null
  dataUnsub?.()
  exitUnsub?.()
  terminal.disconnect()
  if (webglAddon) {
    try { webglAddon.dispose() } catch { /* ignore */ }
    webglAddon = null
  }
  xterm?.dispose()
  xterm = null
  fitAddon = null
})

const statusLabel = computed(() => {
  if (terminal.sessionExpired.value) return 'Session expired — server restarted'
  switch (terminal.status.value) {
    case 'connecting': return 'Connecting...'
    case 'connected': return ''
    case 'reconnecting': return `Reconnecting (attempt ${terminal.reconnectAttempt.value}/${terminal.reconnectMax})...`
    case 'disconnected': return 'Disconnected'
    case 'error': return terminal.errorMessage.value || 'Connection failed'
  }
})

const showOverlay = computed(() => {
  if (terminal.status.value === 'connected') return false
  if (connectedAgentId.value === null) return false
  // Don't show overlay during initial connection (before first successful connect)
  if (!terminal.hasConnectedOnce.value && terminal.status.value === 'connecting') return false
  // Always show overlay during reconnection attempts
  if (terminal.status.value === 'reconnecting') return true
  // Show overlay for session expired, errors, or disconnected-after-previous-connection
  return terminal.hasConnectedOnce.value || terminal.sessionExpired.value || terminal.status.value === 'error'
})
</script>

<template>
  <div
    class="terminal-view relative h-full w-full"
    :style="{ backgroundColor: getTerminalTheme().background }"
  >
    <div ref="containerRef" class="absolute inset-0" style="contain: strict" />

    <!-- Connection status overlay -->
    <Transition name="fade">
      <div
        v-if="showOverlay"
        class="absolute inset-0 z-10 flex items-center justify-center bg-black/60"
      >
        <div class="rounded-lg bg-(--ui-bg-muted) px-6 py-4 text-center shadow-xl">
          <div
            v-if="terminal.status.value === 'connecting'"
            class="mb-2 flex items-center justify-center gap-2"
          >
            <div class="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            <span class="text-sm text-(--ui-text-muted)">{{ statusLabel }}</span>
          </div>
          <div v-else-if="terminal.status.value === 'reconnecting'">
            <div class="mb-2 flex items-center justify-center gap-2">
              <div class="h-3 w-3 animate-pulse rounded-full bg-amber-400" />
              <span class="text-sm text-amber-400">{{ statusLabel }}</span>
            </div>
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              label="Reconnect now"
              @click="terminal.sessionId.value ? terminal.reconnect(terminal.sessionId.value) : (connectedAgentId && connectToAgent(connectedAgentId))"
            />
          </div>
          <div v-else-if="terminal.sessionExpired.value">
            <div class="mb-2 text-sm text-(--ui-text-muted)">
              {{ statusLabel }}
            </div>
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              label="Restart"
              @click="connectedAgentId && connectToAgent(connectedAgentId, props.launchOptions)"
            />
          </div>
          <div v-else>
            <div class="mb-2 text-sm text-(--ui-text-muted)">
              {{ statusLabel }}
            </div>
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              label="Reconnect"
              @click="terminal.sessionId.value ? terminal.reconnect(terminal.sessionId.value) : (connectedAgentId && connectToAgent(connectedAgentId))"
            />
          </div>
        </div>
      </div>
    </Transition>

    <!-- Scroll-to-bottom button -->
    <Transition name="fade">
      <button
        v-if="showScrollDown"
        class="absolute bottom-3 right-4 z-10 flex items-center gap-1 rounded-full bg-(--ui-bg-muted)/80 px-3 py-1.5 text-xs text-(--ui-text-muted) shadow-lg backdrop-blur-sm transition-colors hover:bg-(--ui-bg-accented)/90"
        title="Scroll to bottom"
        @click="scrollToBottom"
      >
        <span class="i-lucide-arrow-down h-3.5 w-3.5" />
        <span>New output</span>
      </button>
    </Transition>
  </div>
</template>

<style>
/* Import xterm.css -- needed for terminal rendering */
@import '@xterm/xterm/css/xterm.css';

.terminal-view .xterm {
  height: 100%;
  padding: 4px;
}

.terminal-view .xterm-viewport {
  overflow-y: auto;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
