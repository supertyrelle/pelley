<script setup lang="ts">
// ---------------------------------------------------------------------------
// Props & Emits
// ---------------------------------------------------------------------------

const props = defineProps<{
  requestId: string
  action: string
  toolName: string
  affectedFiles?: string[]
  status: 'pending' | 'approved' | 'rejected'
}>()

const emit = defineEmits<{
  respond: [requestId: string, approved: boolean, alwaysAllow?: boolean]
}>()

// ---------------------------------------------------------------------------
// Local state
// ---------------------------------------------------------------------------

const alwaysAllow = ref(false)

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const isPending = computed(() => props.status === 'pending')
const isApproved = computed(() => props.status === 'approved')

const visibleFiles = computed(() => props.affectedFiles?.slice(0, 3) ?? [])
const overflowCount = computed(() => {
  const total = props.affectedFiles?.length ?? 0
  return total > 3 ? total - 3 : 0
})

const statusLabel = computed(() => {
  if (props.status === 'approved') return 'Approved'
  if (props.status === 'rejected') return 'Rejected'
  return 'Pending'
})

const statusColor = computed(() => {
  if (props.status === 'approved') return 'success' as const
  if (props.status === 'rejected') return 'error' as const
  return 'neutral' as const
})

const statusIcon = computed(() => {
  if (props.status === 'approved') return 'i-lucide-check'
  if (props.status === 'rejected') return 'i-lucide-x'
  return 'i-lucide-clock'
})

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function approve() {
  emit('respond', props.requestId, true, alwaysAllow.value || undefined)
}

function reject() {
  emit('respond', props.requestId, false)
}
</script>

<template>
  <!-- Collapsed: resolved state -->
  <div
    v-if="!isPending"
    class="flex items-center gap-2 rounded-md border border-(--ui-border) bg-(--ui-bg-muted) px-3 py-1.5"
  >
    <UIcon name="i-lucide-shield" class="h-3.5 w-3.5 text-(--ui-text-dimmed)" />
    <span class="text-xs text-(--ui-text-muted)">
      <span class="font-mono">{{ toolName }}</span>
      &mdash; {{ action }}
    </span>
    <UBadge
      :label="statusLabel"
      :color="statusColor"
      :icon="statusIcon"
      size="xs"
      variant="subtle"
      class="ml-auto"
    />
  </div>

  <!-- Expanded: pending state -->
  <div
    v-else
    class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) shadow-sm"
  >
    <!-- Header -->
    <div class="flex items-start gap-3 px-4 pt-3 pb-2">
      <div class="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-(--ui-bg-accented)">
        <UIcon name="i-lucide-shield-alert" class="h-4 w-4 text-(--ui-text-highlighted)" />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-(--ui-text)">Approval Required</span>
          <UBadge
            :label="toolName"
            color="neutral"
            size="xs"
            variant="subtle"
            class="font-mono"
          />
        </div>

        <p class="mt-0.5 text-sm text-(--ui-text-muted)">
          {{ action }}
        </p>
      </div>
    </div>

    <!-- Affected files -->
    <div
      v-if="affectedFiles?.length"
      class="border-t border-(--ui-border) px-4 py-2"
    >
      <span class="text-xs font-medium text-(--ui-text-dimmed)">Affected files</span>
      <ul class="mt-1 space-y-0.5">
        <li
          v-for="file in visibleFiles"
          :key="file"
          class="flex items-center gap-1.5 text-xs text-(--ui-text-toned)"
        >
          <UIcon name="i-lucide-file" class="h-3 w-3 flex-shrink-0 text-(--ui-text-dimmed)" />
          <span class="truncate font-mono">{{ file }}</span>
        </li>
      </ul>
      <span
        v-if="overflowCount > 0"
        class="mt-1 block text-xs text-(--ui-text-dimmed)"
      >
        +{{ overflowCount }} more
      </span>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between border-t border-(--ui-border) px-4 py-2.5">
      <UCheckbox
        v-model="alwaysAllow"
        label="Always allow"
        size="xs"
      />

      <div class="flex items-center gap-2">
        <UButton
          label="Reject"
          icon="i-lucide-x"
          size="xs"
          color="error"
          variant="soft"
          @click="reject"
        />
        <UButton
          label="Approve"
          icon="i-lucide-check"
          size="xs"
          color="success"
          variant="soft"
          @click="approve"
        />
      </div>
    </div>
  </div>
</template>
