<script setup lang="ts">
import type { AgentDriverEvent, ToolCallStartEvent, ToolCallResultEvent } from '~~/shared/types/agent-driver'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const props = withDefaults(defineProps<{
  events: AgentDriverEvent[]
  collapsed?: boolean
}>(), {
  collapsed: true,
})

// ---------------------------------------------------------------------------
// Tree types
// ---------------------------------------------------------------------------

interface ToolCallNode {
  callId: string
  toolName: string
  input: Record<string, unknown>
  output?: string
  status: 'pending' | 'running' | 'complete' | 'error'
  duration?: number
  error?: string
  children: ToolCallNode[]
}

// ---------------------------------------------------------------------------
// Build tree from flat event stream
// ---------------------------------------------------------------------------

const tree = computed(() => {
  const roots: ToolCallNode[] = []
  /** Stack of currently-open (started but not yet completed) tool calls */
  const stack: ToolCallNode[] = []
  /** Quick lookup by callId for result matching */
  const nodeMap = new Map<string, ToolCallNode>()

  for (const event of props.events) {
    if (event.type === 'tool-call-start') {
      const start = event as ToolCallStartEvent
      const node: ToolCallNode = {
        callId: start.callId,
        toolName: start.toolName,
        input: start.input,
        status: 'running',
        children: [],
      }
      nodeMap.set(start.callId, node)

      // If there is a parent on the stack, nest under it; otherwise root
      if (stack.length > 0) {
        stack[stack.length - 1]!.children.push(node)
      }
      else {
        roots.push(node)
      }
      stack.push(node)
    }
    else if (event.type === 'tool-call-result') {
      const result = event as ToolCallResultEvent
      const node = nodeMap.get(result.callId)
      if (node) {
        node.output = result.output
        node.duration = result.duration
        node.status = result.status === 'error' ? 'error' : 'complete'
        if (result.status === 'error') {
          node.error = result.output
        }
      }
      // Pop the stack back to (and including) the completed call
      const idx = stack.findIndex(n => n.callId === result.callId)
      if (idx !== -1) {
        stack.splice(idx)
      }
    }
  }

  // Anything still on the stack is pending/running
  for (const node of stack) {
    if (node.status === 'running') {
      node.status = 'running'
    }
  }

  return roots
})

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

function countNodes(nodes: ToolCallNode[]): number {
  let count = 0
  for (const node of nodes) {
    count += 1 + countNodes(node.children)
  }
  return count
}

function totalDuration(nodes: ToolCallNode[]): number {
  let ms = 0
  for (const node of nodes) {
    ms += (node.duration ?? 0) + totalDuration(node.children)
  }
  return ms
}

const totalCount = computed(() => countNodes(tree.value))

const formattedTotalDuration = computed(() => {
  const ms = totalDuration(tree.value)
  if (ms === 0) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
})

// ---------------------------------------------------------------------------
// Expand / collapse state
// ---------------------------------------------------------------------------

const expandedNodes = ref(new Set<string>())
const allExpanded = ref(!props.collapsed)

function toggleNode(callId: string) {
  if (expandedNodes.value.has(callId)) {
    expandedNodes.value.delete(callId)
  }
  else {
    expandedNodes.value.add(callId)
  }
}

function isNodeExpanded(callId: string): boolean {
  return allExpanded.value || expandedNodes.value.has(callId)
}

function expandAll() {
  allExpanded.value = true
  expandedNodes.value.clear()
}

function collapseAll() {
  allExpanded.value = false
  expandedNodes.value.clear()
}
</script>

<template>
  <div class="space-y-2">
    <!-- Summary header -->
    <div class="flex items-center gap-2 text-xs text-(--ui-text-dimmed)">
      <UIcon name="i-lucide-git-branch" class="h-3.5 w-3.5" />
      <span class="font-medium">{{ totalCount }} tool call{{ totalCount === 1 ? '' : 's' }}</span>
      <span v-if="formattedTotalDuration" class="tabular-nums">
        ({{ formattedTotalDuration }} total)
      </span>
      <span class="flex-1" />
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="allExpanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
        :label="allExpanded ? 'Collapse all' : 'Expand all'"
        @click="allExpanded ? collapseAll() : expandAll()"
      />
    </div>

    <!-- Tree nodes -->
    <div class="space-y-1">
      <ToolCallTreeNode
        v-for="node in tree"
        :key="node.callId"
        :node="node"
        :depth="0"
        :is-expanded="isNodeExpanded"
        @toggle="toggleNode"
      />
    </div>
  </div>
</template>
