<script setup lang="ts">
import type {
  TextDeltaEvent,
  ToolCallStartEvent,
  ToolCallResultEvent,
  ApprovalRequestEvent,
  ApprovalResponseEvent,
  FileChangeEvent,
  ThinkingEvent,
  ProgressEvent,
  ErrorEvent,
  CompleteEvent,
  UserMessageEvent,
} from '~~/shared/types/agent-driver'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const props = defineProps<{
  agentId: string
  panelId: string
  modelOverride?: { provider: string; model: string }
  cwd?: string
}>()

// ---------------------------------------------------------------------------
// Agent driver
// ---------------------------------------------------------------------------

const driver = useAgentDriver()

// Share driver state with PanelHeader via useState (siblings in component tree)
const sharedAgentStatus = useState<string | null>(`driver-status-${props.panelId}`, () => null)
const sharedTokensUsed = useState<{ input: number; output: number } | null>(`driver-tokens-${props.panelId}`, () => null)
const sharedPendingApprovals = useState<number>(`driver-approvals-${props.panelId}`, () => 0)
const sharedTokensPerSecond = useState<number | null>(`driver-tps-${props.panelId}`, () => null)
const sharedIsThinking = useState<boolean>(`driver-thinking-${props.panelId}`, () => false)

watch(driver.agentStatus, (v) => { sharedAgentStatus.value = v }, { immediate: true })
watch(driver.tokensUsed, (v) => { sharedTokensUsed.value = v }, { immediate: true })
watch(() => driver.pendingApprovals.value.length, (v) => { sharedPendingApprovals.value = v }, { immediate: true })
watch(driver.tokensPerSecond, (v) => { sharedTokensPerSecond.value = v }, { immediate: true })
watch(driver.isThinking, (v) => { sharedIsThinking.value = v }, { immediate: true })

// ---------------------------------------------------------------------------
// Merged display blocks
// ---------------------------------------------------------------------------
// Consecutive text-delta events are accumulated into a single text block.
// Tool-call-start and tool-call-result are paired by callId.

interface TextBlock {
  kind: 'text'
  content: string
  streaming: boolean
  afterThinking?: boolean
}

interface ToolCallBlock {
  kind: 'tool-call'
  callId: string
  toolName: string
  input: Record<string, unknown>
  output?: string
  status: 'pending' | 'running' | 'complete' | 'error'
  duration?: number
  error?: string
}

interface ApprovalBlock {
  kind: 'approval'
  requestId: string
  action: string
  toolName: string
  affectedFiles?: string[]
  status: 'pending' | 'approved' | 'rejected'
}

interface FileChangeBlock {
  kind: 'file-change'
  filePath: string
  editType: 'create' | 'edit' | 'delete'
  before?: string
  after: string
  diff?: FileChangeEvent['diff']
}

interface ThinkingBlock {
  kind: 'thinking'
  active: boolean
  phase?: string
  startedAt: number
  reasoning?: string
}

interface ProgressBlock {
  kind: 'progress'
  message: string
  percentage?: number
}

interface ErrorBlock {
  kind: 'error'
  message: string
  fatal: boolean
}

interface CompleteBlock {
  kind: 'complete'
  summary?: string
  tokensUsed?: { input: number; output: number }
}

interface UserMessageBlock {
  kind: 'user-message'
  content: string
}

type DisplayBlock =
  | TextBlock
  | ToolCallBlock
  | ApprovalBlock
  | FileChangeBlock
  | ThinkingBlock
  | ProgressBlock
  | ErrorBlock
  | CompleteBlock
  | UserMessageBlock

// Incrementally-maintained display blocks.
// Instead of recomputing all blocks from all events on every text-delta,
// we track which events have been processed and only handle new ones.

const displayBlocks = shallowRef<DisplayBlock[]>([])
const lastProcessedIndex = ref(0)
const toolCallBlockIndex = new Map<string, number>() // callId -> block index
const approvalBlockIndex = new Map<string, number>() // requestId -> block index
let lastStreamingBlockIdx = -1 // index of block currently marked streaming
let lastActiveThinkingIdx = -1 // index of block currently marked as active thinking

function processNewEvents() {
  const events = driver.events.value
  const newLen = events.length
  const startIdx = lastProcessedIndex.value

  if (startIdx >= newLen) return

  const blocks = displayBlocks.value
  let mutated = false

  for (let i = startIdx; i < newLen; i++) {
    const evt = events[i]!

    switch (evt.type) {
      case 'user-message': {
        blocks.push({
          kind: 'user-message',
          content: (evt as UserMessageEvent).content,
        })
        mutated = true
        break
      }

      case 'text-delta': {
        const last = blocks[blocks.length - 1]
        if (last && last.kind === 'text') {
          last.content += (evt as TextDeltaEvent).content
          mutated = true
        }
        else {
          const prev = blocks[blocks.length - 1]
          blocks.push({
            kind: 'text',
            content: (evt as TextDeltaEvent).content,
            streaming: false,
            afterThinking: prev?.kind === 'thinking' ? true : undefined,
          })
          mutated = true
        }
        break
      }

      case 'tool-call-start': {
        const e = evt as ToolCallStartEvent
        toolCallBlockIndex.set(e.callId, blocks.length)
        blocks.push({
          kind: 'tool-call',
          callId: e.callId,
          toolName: e.toolName,
          input: e.input,
          status: 'running',
        })
        mutated = true
        break
      }

      case 'tool-call-result': {
        const e = evt as ToolCallResultEvent
        const existingIdx = toolCallBlockIndex.get(e.callId)
        if (existingIdx != null && blocks[existingIdx]?.kind === 'tool-call') {
          const block = blocks[existingIdx] as ToolCallBlock
          block.output = e.output
          block.duration = e.duration
          block.status = e.status === 'error' ? 'error' : 'complete'
          if (e.status === 'error') {
            block.error = e.output
          }
        }
        else {
          blocks.push({
            kind: 'tool-call',
            callId: e.callId,
            toolName: e.toolName,
            input: {},
            output: e.output,
            status: e.status === 'error' ? 'error' : 'complete',
            duration: e.duration,
            error: e.status === 'error' ? e.output : undefined,
          })
        }
        mutated = true
        break
      }

      case 'approval-request': {
        const e = evt as ApprovalRequestEvent
        approvalBlockIndex.set(e.requestId, blocks.length)
        blocks.push({
          kind: 'approval',
          requestId: e.requestId,
          action: e.action,
          toolName: e.toolName,
          affectedFiles: e.affectedFiles,
          status: 'pending',
        })
        mutated = true
        break
      }

      case 'approval-response': {
        const e = evt as ApprovalResponseEvent
        const existingIdx = approvalBlockIndex.get(e.requestId)
        if (existingIdx != null && blocks[existingIdx]?.kind === 'approval') {
          (blocks[existingIdx] as ApprovalBlock).status = e.approved ? 'approved' : 'rejected'
          mutated = true
        }
        break
      }

      case 'file-change': {
        const e = evt as FileChangeEvent
        blocks.push({
          kind: 'file-change',
          filePath: e.filePath,
          editType: e.editType,
          before: e.before,
          after: e.after,
          diff: e.diff,
        })
        mutated = true
        break
      }

      case 'thinking': {
        const e = evt as ThinkingEvent

        if (e.active && e.content) {
          // Thinking delta with content — accumulate into existing block or create new one
          const lastBlock = lastActiveThinkingIdx >= 0 ? blocks[lastActiveThinkingIdx] : undefined
          if (lastBlock?.kind === 'thinking' && lastBlock.active) {
            // Append to the existing active thinking block
            ;(lastBlock as ThinkingBlock).reasoning = (lastBlock.reasoning ?? '') + e.content
          }
          else {
            // First thinking content or thinking restarted — create new block
            lastActiveThinkingIdx = blocks.length
            blocks.push({
              kind: 'thinking',
              active: true,
              phase: e.phase,
              startedAt: e.timestamp,
              reasoning: e.content,
            })
          }
        }
        else if (e.active) {
          // Thinking-start signal (active but no content) — new thinking phase
          if (lastActiveThinkingIdx >= 0 && blocks[lastActiveThinkingIdx]?.kind === 'thinking') {
            (blocks[lastActiveThinkingIdx] as ThinkingBlock).active = false
          }
          lastActiveThinkingIdx = blocks.length
          blocks.push({
            kind: 'thinking',
            active: true,
            phase: e.phase,
            startedAt: e.timestamp,
          })
        }
        else {
          // Thinking-end signal (active: false)
          if (lastActiveThinkingIdx >= 0 && blocks[lastActiveThinkingIdx]?.kind === 'thinking') {
            (blocks[lastActiveThinkingIdx] as ThinkingBlock).active = false
            lastActiveThinkingIdx = -1
          }
        }

        mutated = true
        break
      }

      case 'progress': {
        const e = evt as ProgressEvent
        blocks.push({
          kind: 'progress',
          message: e.message,
          percentage: e.percentage,
        })
        mutated = true
        break
      }

      case 'error': {
        const e = evt as ErrorEvent
        blocks.push({
          kind: 'error',
          message: e.message,
          fatal: e.fatal,
        })
        mutated = true
        break
      }

      case 'complete': {
        const e = evt as CompleteEvent
        blocks.push({
          kind: 'complete',
          summary: e.summary,
          tokensUsed: e.tokensUsed,
        })
        mutated = true
        break
      }
    }
  }

  lastProcessedIndex.value = newLen

  if (mutated) {
    triggerRef(displayBlocks)
  }
}

// Update streaming flag on the last text block based on agent status
function updateStreamingFlag() {
  const blocks = displayBlocks.value
  const isRunning = driver.agentStatus.value === 'running'

  // Clear previous streaming marker
  if (lastStreamingBlockIdx >= 0 && blocks[lastStreamingBlockIdx]?.kind === 'text') {
    (blocks[lastStreamingBlockIdx] as TextBlock).streaming = false
  }
  lastStreamingBlockIdx = -1

  if (isRunning) {
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i]!.kind === 'text') {
        (blocks[i] as TextBlock).streaming = true
        lastStreamingBlockIdx = i
        break
      }
    }
  }

  // Update thinking block active state when agent stops thinking
  if (!driver.isThinking.value && lastActiveThinkingIdx >= 0 && blocks[lastActiveThinkingIdx]?.kind === 'thinking') {
    (blocks[lastActiveThinkingIdx] as ThinkingBlock).active = false
    lastActiveThinkingIdx = -1
  }

  if (blocks.length > 0) {
    triggerRef(displayBlocks)
  }
}

// Process new events incrementally when events array grows
watch(() => driver.events.value.length, processNewEvents)

// Update streaming/thinking flags when agent status changes
watch([driver.agentStatus, driver.isThinking], updateStreamingFlag)

// Reset everything when events are cleared (new session / reconnect with replay)
watch(driver.events, (newEvents, oldEvents) => {
  // Detect reset: either array is empty, or it's a completely new array that
  // is shorter (replay after reconnect replaces the array)
  if (newEvents.length === 0 || (oldEvents && newEvents.length < lastProcessedIndex.value)) {
    displayBlocks.value = []
    lastProcessedIndex.value = 0
    toolCallBlockIndex.clear()
    approvalBlockIndex.clear()
    lastStreamingBlockIdx = -1
    lastActiveThinkingIdx = -1
    // Process any events that came with the new array (replay scenario)
    if (newEvents.length > 0) {
      processNewEvents()
    }
  }
})

// ---------------------------------------------------------------------------
// Input handling (delegated to ConversationInput component)
// ---------------------------------------------------------------------------

async function handleSend(message: string) {
  await driver.sendPrompt(message)
}

// ---------------------------------------------------------------------------
// Approval handling
// ---------------------------------------------------------------------------

function handleApprovalResponse(requestId: string, approved: boolean, alwaysAllow?: boolean) {
  driver.respondToApproval(requestId, approved, alwaysAllow)
}

// ---------------------------------------------------------------------------
// Auto-scroll
// ---------------------------------------------------------------------------

const scrollContainer = ref<HTMLElement | null>(null)
const userScrolledUp = ref(false)

function checkIfUserScrolledUp() {
  const el = scrollContainer.value
  if (!el) return
  // Consider "at bottom" if within 50px of the bottom
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
  userScrolledUp.value = !atBottom
}

function scrollToBottom() {
  const el = scrollContainer.value
  if (el) {
    el.scrollTop = el.scrollHeight
    userScrolledUp.value = false
  }
}

watch(
  () => driver.events.value.length,
  () => {
    if (!userScrolledUp.value) {
      nextTick(scrollToBottom)
    }
  },
)

// ---------------------------------------------------------------------------
// Connection overlay
// ---------------------------------------------------------------------------

const showOverlay = computed(() => {
  return driver.status.value === 'error'
})

// ---------------------------------------------------------------------------
// Lifecycle: auto-connect on mount
// ---------------------------------------------------------------------------

onMounted(() => {
  driver.connect(props.agentId, {
    modelOverride: props.modelOverride,
    cwd: props.cwd,
  })
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Connection status overlay -->
    <Transition name="fade">
      <div
        v-if="showOverlay"
        class="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
      >
        <div class="rounded-lg bg-(--ui-bg-muted) px-6 py-4 text-center shadow-xl">
          <p class="mb-2 text-sm text-(--ui-text-muted)">
            {{ driver.errorMessage.value ?? 'Connection failed' }}
          </p>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            label="Reconnect"
            @click="driver.connect(props.agentId, { modelOverride: props.modelOverride, cwd: props.cwd })"
          />
        </div>
      </div>
    </Transition>

    <!-- Scrollable event stream -->
    <div
      ref="scrollContainer"
      class="flex-1 space-y-3 overflow-y-auto p-4"
      @scroll="checkIfUserScrolledUp"
    >
      <!-- Empty state -->
      <div
        v-if="displayBlocks.length === 0 && driver.status.value !== 'error'"
        class="flex h-full flex-col items-center justify-center gap-2 text-(--ui-text-dimmed)"
      >
        <UIcon name="i-lucide-message-square" class="h-10 w-10 opacity-50" />
        <span class="text-sm">Send a message to get started</span>
        <span
          v-if="driver.status.value === 'connecting'"
          class="text-xs text-(--ui-text-dimmed)"
        >
          Connecting...
        </span>
      </div>

      <template v-for="(block, idx) in displayBlocks" :key="idx">
        <!-- User message -->
        <div
          v-if="block.kind === 'user-message'"
          class="flex justify-end"
        >
          <div class="max-w-[80%] rounded-2xl rounded-br-md bg-primary-500 px-4 py-2.5 text-sm text-white dark:bg-primary-600">
            {{ block.content }}
          </div>
        </div>

        <!-- Text (markdown) -->
        <MarkdownRenderer
          v-else-if="block.kind === 'text'"
          :content="block.content"
          :streaming="block.streaming"
          :class="{ 'animate-fade-in': block.afterThinking }"
        />

        <!-- Tool call -->
        <ToolCallCard
          v-else-if="block.kind === 'tool-call'"
          :call-id="block.callId"
          :tool-name="block.toolName"
          :input="block.input"
          :output="block.output"
          :status="block.status"
          :duration="block.duration"
          :error="block.error"
        />

        <!-- Approval request -->
        <ApprovalCard
          v-else-if="block.kind === 'approval'"
          :request-id="block.requestId"
          :action="block.action"
          :tool-name="block.toolName"
          :affected-files="block.affectedFiles"
          :status="block.status"
          @respond="handleApprovalResponse"
        />

        <!-- File change -->
        <InlineFileChange
          v-else-if="block.kind === 'file-change'"
          :file-path="block.filePath"
          :edit-type="block.editType"
          :before="block.before"
          :after="block.after"
          :diff="block.diff"
        />

        <!-- Thinking -->
        <ThinkingIndicator
          v-else-if="block.kind === 'thinking'"
          :active="block.active"
          :phase="block.phase"
          :started-at="block.startedAt"
          :reasoning="block.reasoning"
        />

        <!-- Progress -->
        <div
          v-else-if="block.kind === 'progress'"
          class="flex items-center gap-3 rounded-md bg-(--ui-bg-muted) px-3 py-2"
        >
          <UIcon name="i-lucide-loader-2" class="h-4 w-4 animate-spin text-(--ui-text-dimmed)" />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-(--ui-text-muted)">
              {{ block.message }}
            </p>
            <div
              v-if="block.percentage != null"
              class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-(--ui-bg-accented)"
            >
              <div
                class="h-full rounded-full bg-primary-500 transition-all duration-300"
                :style="{ width: `${block.percentage}%` }"
              />
            </div>
          </div>
          <span
            v-if="block.percentage != null"
            class="text-xs tabular-nums text-(--ui-text-dimmed)"
          >
            {{ block.percentage }}%
          </span>
        </div>

        <!-- Error -->
        <div
          v-else-if="block.kind === 'error'"
          class="rounded-lg border px-3 py-2.5 text-sm"
          :class="block.fatal
            ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
            : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400'"
        >
          <div class="flex items-start gap-2">
            <UIcon
              :name="block.fatal ? 'i-lucide-circle-x' : 'i-lucide-alert-triangle'"
              class="mt-0.5 h-4 w-4 flex-shrink-0"
            />
            <span>{{ block.message }}</span>
          </div>
        </div>

        <!-- Complete -->
        <div
          v-else-if="block.kind === 'complete'"
          class="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 dark:border-green-800 dark:bg-green-900/20"
        >
          <div class="flex items-start gap-2">
            <UIcon name="i-lucide-check-circle" class="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-green-700 dark:text-green-300">
                Complete
              </p>
              <p v-if="block.summary" class="mt-0.5 text-sm text-green-600 dark:text-green-400">
                {{ block.summary }}
              </p>
              <p
                v-if="block.tokensUsed"
                class="mt-1 text-xs text-green-500 dark:text-green-500"
              >
                Tokens: {{ block.tokensUsed.input.toLocaleString() }} in / {{ block.tokensUsed.output.toLocaleString() }} out
              </p>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Scroll-to-bottom button -->
    <Transition name="fade">
      <button
        v-if="userScrolledUp"
        class="absolute bottom-16 right-4 z-10 flex items-center gap-1 rounded-full bg-(--ui-bg-muted)/80 px-3 py-1.5 text-xs text-(--ui-text-muted) shadow-lg backdrop-blur-sm transition-colors hover:bg-(--ui-bg-accented)/90"
        @click="scrollToBottom"
      >
        <UIcon name="i-lucide-arrow-down" class="h-3.5 w-3.5" />
        <span>New output</span>
      </button>
    </Transition>

    <!-- Input area -->
    <ConversationInput
      :agent-status="driver.agentStatus.value"
      :is-thinking="driver.isThinking.value"
      :disabled="driver.status.value !== 'connected'"
      @send="handleSend"
    />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.animate-fade-in {
  animation: fade-in 0.4s ease-out;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
