<script setup lang="ts">
// ---------------------------------------------------------------------------
// Recursive tree node — renders a ToolCallCard with indentation and children
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

const props = defineProps<{
  node: ToolCallNode
  depth: number
  isExpanded: (callId: string) => boolean
}>()

const emit = defineEmits<{
  toggle: [callId: string]
}>()

const hasChildren = computed(() => props.node.children.length > 0)
const expanded = computed(() => props.isExpanded(props.node.callId))
</script>

<template>
  <div :style="{ paddingLeft: `${depth * 20}px` }">
    <!-- Tree connector + card -->
    <div class="flex items-start gap-1">
      <!-- Expand/collapse toggle for nodes with children -->
      <button
        v-if="hasChildren"
        class="mt-2.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-(--ui-text-dimmed) hover:bg-(--ui-bg-accented)"
        @click="emit('toggle', node.callId)"
      >
        <UIcon
          :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="h-3 w-3"
        />
      </button>
      <div v-else class="w-4 flex-shrink-0" />

      <!-- The actual tool call card -->
      <div class="min-w-0 flex-1">
        <ToolCallCard
          :call-id="node.callId"
          :tool-name="node.toolName"
          :input="node.input"
          :output="node.output"
          :status="node.status"
          :duration="node.duration"
          :error="node.error"
        />
      </div>
    </div>

    <!-- Recursively render children when expanded -->
    <template v-if="hasChildren && expanded">
      <ToolCallTreeNode
        v-for="child in node.children"
        :key="child.callId"
        :node="child"
        :depth="depth + 1"
        :is-expanded="isExpanded"
        @toggle="(callId: string) => emit('toggle', callId)"
      />
    </template>
  </div>
</template>
