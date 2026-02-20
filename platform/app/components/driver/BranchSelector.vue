<script setup lang="ts">
// ---------------------------------------------------------------------------
// Props & Emits
// ---------------------------------------------------------------------------

interface BranchInfo {
  id: string
  branchPoint: number
  createdAt: Date
}

const props = defineProps<{
  currentSessionId: string
  branches: BranchInfo[]
}>()

const emit = defineEmits<{
  'select-branch': [sessionId: string]
  'create-branch': [fromSeq: number]
}>()

// ---------------------------------------------------------------------------
// Overflow handling — show max 5 branches inline, rest in dropdown
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 5

const visibleBranches = computed(() => props.branches.slice(0, MAX_VISIBLE))
const overflowBranches = computed(() => props.branches.slice(MAX_VISIBLE))
const hasOverflow = computed(() => props.branches.length > MAX_VISIBLE)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isActive(branch: BranchInfo): boolean {
  return branch.id === props.currentSessionId
}

function branchLabel(branch: BranchInfo): string {
  return `Branch from step ${branch.branchPoint}`
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Dropdown state for overflow
// ---------------------------------------------------------------------------

const showOverflow = ref(false)

function toggleOverflow() {
  showOverflow.value = !showOverflow.value
}

function selectOverflowBranch(id: string) {
  showOverflow.value = false
  emit('select-branch', id)
}
</script>

<template>
  <div class="flex items-center gap-1 overflow-x-auto">
    <!-- Main (parent) tab -->
    <button
      class="flex-shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
      :class="branches.every(b => !isActive(b))
        ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300'
        : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-accented)'"
      @click="emit('select-branch', currentSessionId)"
    >
      Main
    </button>

    <!-- Visible branch tabs -->
    <button
      v-for="branch in visibleBranches"
      :key="branch.id"
      class="flex flex-shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors"
      :class="isActive(branch)
        ? 'bg-primary-100 font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-300'
        : 'bg-(--ui-bg-muted) text-(--ui-text-muted) hover:bg-(--ui-bg-accented)'"
      :title="`${branchLabel(branch)} — ${formatDate(branch.createdAt)}`"
      @click="emit('select-branch', branch.id)"
    >
      <UIcon name="i-lucide-git-branch" class="h-3 w-3" />
      <span>{{ branchLabel(branch) }}</span>
      <span class="text-(--ui-text-dimmed)">{{ formatDate(branch.createdAt) }}</span>
    </button>

    <!-- Overflow dropdown -->
    <div v-if="hasOverflow" class="relative flex-shrink-0">
      <button
        class="flex items-center gap-0.5 rounded-md bg-(--ui-bg-muted) px-2 py-1 text-xs text-(--ui-text-muted) hover:bg-(--ui-bg-accented)"
        @click="toggleOverflow"
      >
        <span>+{{ overflowBranches.length }} more</span>
        <UIcon
          :name="showOverflow ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="h-3 w-3"
        />
      </button>

      <!-- Overflow popover -->
      <Transition name="fade">
        <div
          v-if="showOverflow"
          class="absolute right-0 top-full z-20 mt-1 min-w-48 rounded-lg border border-(--ui-border) bg-(--ui-bg) p-1 shadow-lg"
        >
          <button
            v-for="branch in overflowBranches"
            :key="branch.id"
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-(--ui-bg-muted)"
            :class="isActive(branch) ? 'font-medium text-primary-600 dark:text-primary-400' : 'text-(--ui-text-muted)'"
            @click="selectOverflowBranch(branch.id)"
          >
            <UIcon name="i-lucide-git-branch" class="h-3 w-3 flex-shrink-0" />
            <div class="min-w-0 flex-1">
              <div>{{ branchLabel(branch) }}</div>
              <div class="text-(--ui-text-dimmed)">{{ formatDate(branch.createdAt) }}</div>
            </div>
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
