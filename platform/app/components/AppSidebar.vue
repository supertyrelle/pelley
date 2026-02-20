<script setup lang="ts">
import type { AgentConfig } from '~~/shared/types/agent'
import type { Bead } from '~~/shared/types/bead'
import type { Task, CreateTaskOptions } from '~~/shared/types/task'

// -----------------------------------------------------------------------
// Props / emits
// -----------------------------------------------------------------------

const props = defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits<{
  'update:collapsed': [value: boolean]
  'focus-panel': [panelId: string]
}>()

// -----------------------------------------------------------------------
// Composables
// -----------------------------------------------------------------------

const { tasks, createTask } = useTaskManager()
const { getVisualPlugins } = usePlugins()
const { stats, connected, onBeadEvent } = useBeadsSync()
const { panels, addPanel, setActivePanel } = useTilingLayout()
const {
  beads,
  openBeads,
  loading: beadsLoading,
  createBead,
  updateBead,
  closeBead,
  getBead,
  refresh: refreshBeads,
} = useBeads()

const { data: agents } = useFetch<AgentConfig[]>('/api/agents')

// Auto-refresh beads on bead events from WebSocket
if (import.meta.client) {
  onMounted(() => {
    onBeadEvent((event) => {
      if (['bead:created', 'bead:updated', 'bead:closed'].includes(event.type)) {
        refreshBeads()
      }
    })
  })
}

// -----------------------------------------------------------------------
// Sidebar toggle
// -----------------------------------------------------------------------

const isCollapsed = computed({
  get: () => props.collapsed,
  set: (val: boolean) => emit('update:collapsed', val),
})

function toggleSidebar() {
  isCollapsed.value = !isCollapsed.value
}

// -----------------------------------------------------------------------
// Project section
// -----------------------------------------------------------------------

const uniqueProjectPaths = computed(() => {
  const paths = new Set(tasks.value.map(t => t.projectPath))
  return [...paths].sort()
})

const activeProjectPath = ref<string>('')

// Initialize project path from first task
watch(tasks, (list) => {
  if (!activeProjectPath.value && list.length > 0) {
    activeProjectPath.value = list[0]!.projectPath
  }
}, { immediate: true })

const projectName = computed(() => {
  if (!activeProjectPath.value) return 'No Project'
  const parts = activeProjectPath.value.split('/')
  return parts[parts.length - 1] ?? activeProjectPath.value
})

const truncatedPath = computed(() => {
  const path = activeProjectPath.value
  if (!path) return ''
  if (path.length <= 30) return path
  return '...' + path.slice(-27)
})

// -----------------------------------------------------------------------
// Tasks section
// -----------------------------------------------------------------------

function taskStatusColor(status: string): string {
  switch (status) {
    case 'running': return 'bg-green-500'
    case 'pending': return 'bg-yellow-500'
    case 'completed': return 'bg-gray-400'
    case 'failed': return 'bg-red-500'
    default: return 'bg-gray-400'
  }
}

function onTaskClick(task: Task) {
  if (task.status !== 'running') return
  // Find panel with matching agentId and focus it
  const panel = panels.value.find(p => p.agentId === task.agentId)
  if (panel) {
    setActivePanel(panel.id)
    emit('focus-panel', panel.id)
  }
}

// New task form
const showNewTaskForm = ref(false)
const newTaskTitle = ref('')
const newTaskAgentId = ref('')
const newTaskWorktree = ref(false)
const creatingTask = ref(false)

const agentOptions = computed(() => {
  if (!agents.value) return []
  return agents.value.map(a => ({ label: a.name, value: a.id }))
})

async function submitNewTask() {
  if (!newTaskTitle.value.trim() || !newTaskAgentId.value || !activeProjectPath.value) return

  creatingTask.value = true
  try {
    const options: CreateTaskOptions = {
      title: newTaskTitle.value.trim(),
      agentId: newTaskAgentId.value,
      projectPath: activeProjectPath.value,
      useWorktree: newTaskWorktree.value,
    }
    await createTask(options)
    // Reset form
    newTaskTitle.value = ''
    newTaskAgentId.value = ''
    newTaskWorktree.value = false
    showNewTaskForm.value = false
  }
  catch (err) {
    console.error('[AppSidebar] Failed to create task:', err)
  }
  finally {
    creatingTask.value = false
  }
}

// -----------------------------------------------------------------------
// Backlog section
// -----------------------------------------------------------------------

type BeadFilter = 'open' | 'in-progress' | 'all'
const beadFilter = ref<BeadFilter>('open')

const filteredBeads = computed(() => {
  if (beadFilter.value === 'all') return beads.value
  return beads.value.filter(b => b.status === beadFilter.value)
})

function beadStatusColor(status: string): string {
  switch (status) {
    case 'open': return 'bg-blue-500'
    case 'in-progress': return 'bg-yellow-500'
    case 'blocked': return 'bg-red-500'
    case 'closed': return 'bg-gray-400'
    case 'deferred': return 'bg-gray-400'
    default: return 'bg-gray-400'
  }
}

function priorityLabel(p: number | undefined): string | null {
  if (p === undefined || p === null) return null
  return `P${p}`
}

function priorityColor(p: number | undefined): string {
  switch (p) {
    case 0: return 'text-red-500'
    case 1: return 'text-orange-500'
    case 2: return 'text-yellow-500'
    default: return 'text-gray-400'
  }
}

// New bead form
const showNewBeadForm = ref(false)
const newBeadTitle = ref('')
const newBeadType = ref('task')
const newBeadPriority = ref<string>('')
const creatingBead = ref(false)

const beadTypeOptions = [
  { label: 'Task', value: 'task' },
  { label: 'Bug', value: 'bug' },
  { label: 'Feature', value: 'feature' },
  { label: 'Spike', value: 'spike' },
  { label: 'Epic', value: 'epic' },
  { label: 'Chore', value: 'chore' },
  { label: 'Decision', value: 'decision' },
]

const beadPriorityOptions = [
  { label: 'None', value: '' },
  { label: 'P0 - Critical', value: '0' },
  { label: 'P1 - High', value: '1' },
  { label: 'P2 - Medium', value: '2' },
  { label: 'P3 - Low', value: '3' },
]

async function submitNewBead() {
  if (!newBeadTitle.value.trim()) return

  creatingBead.value = true
  try {
    await createBead({
      title: newBeadTitle.value.trim(),
      type: newBeadType.value,
      priority: newBeadPriority.value ? Number(newBeadPriority.value) : undefined,
    })
    // Reset form
    newBeadTitle.value = ''
    newBeadType.value = 'task'
    newBeadPriority.value = ''
    showNewBeadForm.value = false
  }
  catch (err) {
    console.error('[AppSidebar] Failed to create bead:', err)
  }
  finally {
    creatingBead.value = false
  }
}

// Bead detail
const selectedBead = ref<Bead | null>(null)
const loadingDetail = ref(false)
const detailAssignee = ref('')

async function selectBead(beadId: string) {
  loadingDetail.value = true
  try {
    const full = await getBead(beadId)
    selectedBead.value = full
    detailAssignee.value = full.assignee ?? ''
  }
  catch (err) {
    console.error('[AppSidebar] Failed to load bead detail:', err)
  }
  finally {
    loadingDetail.value = false
  }
}

function closeBeadDetail() {
  selectedBead.value = null
}

async function closeSelectedBead() {
  if (!selectedBead.value) return
  try {
    await closeBead(selectedBead.value.id)
    selectedBead.value = { ...selectedBead.value, status: 'closed' }
  }
  catch (err) {
    console.error('[AppSidebar] Failed to close bead:', err)
  }
}

async function updateDetailAssignee() {
  if (!selectedBead.value) return
  try {
    const updated = await updateBead(selectedBead.value.id, { assignee: detailAssignee.value || undefined })
    selectedBead.value = updated
  }
  catch (err) {
    console.error('[AppSidebar] Failed to update assignee:', err)
  }
}

// -----------------------------------------------------------------------
// Plugins section
// -----------------------------------------------------------------------

const visualPlugins = computed(() => getVisualPlugins())

function onPluginClick(pluginId: string) {
  addPanel(pluginId)
}

// -----------------------------------------------------------------------
// Context section
// -----------------------------------------------------------------------

const sharedSessionCount = computed(() =>
  tasks.value.filter(t => t.contextScope === 'shared' && t.status === 'running').length,
)

const isolatedSessionCount = computed(() =>
  tasks.value.filter(t => t.contextScope === 'isolated' && t.status === 'running').length,
)

const beadsOpen = computed(() => stats.value?.open ?? 0)
const beadsClosed = computed(() => stats.value?.closed ?? 0)
const beadsInProgress = computed(() => stats.value?.inProgress ?? 0)
</script>

<template>
  <aside
    class="flex h-full flex-shrink-0 flex-col border-r border-(--ui-border) bg-(--ui-bg) transition-[width] duration-300 ease-in-out"
    :style="{ width: isCollapsed ? '48px' : '240px' }"
  >
    <!-- Toggle button -->
    <div
      class="flex h-12 flex-shrink-0 items-center border-b border-(--ui-border)"
      :class="isCollapsed ? 'justify-center' : 'justify-between px-3'"
    >
      <span
        v-if="!isCollapsed"
        class="truncate text-sm font-semibold text-(--ui-text-toned)"
      >
        pelley
      </span>
      <UButton
        :icon="isCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
        size="xs"
        color="neutral"
        variant="ghost"
        @click="toggleSidebar"
      />
    </div>

    <!-- Collapsed: icon-only navigation -->
    <div v-if="isCollapsed" class="flex flex-1 flex-col items-center gap-1 py-2">
      <UTooltip text="Project" :content="{ side: 'right' }">
        <UButton icon="i-lucide-folder" size="xs" color="neutral" variant="ghost" />
      </UTooltip>
      <UTooltip text="Tasks" :content="{ side: 'right' }">
        <UButton icon="i-lucide-list-checks" size="xs" color="neutral" variant="ghost" />
      </UTooltip>
      <UTooltip text="Backlog" :content="{ side: 'right' }">
        <UButton icon="i-lucide-circle-dot" size="xs" color="neutral" variant="ghost" />
      </UTooltip>
      <UTooltip text="Plugins" :content="{ side: 'right' }">
        <NuxtLink to="/plugins">
          <UButton icon="i-lucide-puzzle" size="xs" color="neutral" variant="ghost" />
        </NuxtLink>
      </UTooltip>
      <UTooltip text="Context" :content="{ side: 'right' }">
        <UButton icon="i-lucide-layers" size="xs" color="neutral" variant="ghost" />
      </UTooltip>
    </div>

    <!-- Expanded: full sections -->
    <div v-else class="flex flex-1 flex-col overflow-y-auto">
      <!-- ============================================================= -->
      <!-- Project Section                                                 -->
      <!-- ============================================================= -->
      <div class="border-b border-(--ui-border) px-3 py-3">
        <div class="mb-2 flex items-center gap-1.5">
          <UIcon name="i-lucide-folder" class="h-4 w-4 flex-shrink-0 text-(--ui-text-muted)" />
          <span class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
            Project
          </span>
        </div>

        <div class="mb-1 truncate text-sm font-medium text-(--ui-text)">
          {{ projectName }}
        </div>

        <div class="mb-2 truncate text-xs text-(--ui-text-muted)" :title="activeProjectPath">
          {{ truncatedPath }}
        </div>

        <USelect
          v-if="uniqueProjectPaths.length > 1"
          v-model="activeProjectPath"
          :items="uniqueProjectPaths.map(p => ({ label: p.split('/').pop() || p, value: p }))"
          value-key="value"
          placeholder="Switch project..."
          size="xs"
          class="w-full"
        />
      </div>

      <!-- ============================================================= -->
      <!-- Tasks Section                                                   -->
      <!-- ============================================================= -->
      <div class="border-b border-(--ui-border) px-3 py-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-list-checks" class="h-4 w-4 flex-shrink-0 text-(--ui-text-muted)" />
            <span class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
              Tasks
            </span>
            <UBadge size="xs" color="neutral" variant="subtle">
              {{ tasks.length }}
            </UBadge>
          </div>
          <UButton
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="showNewTaskForm = !showNewTaskForm"
          />
        </div>

        <!-- New task inline form -->
        <div v-if="showNewTaskForm" class="mb-2 space-y-2 rounded-md border border-(--ui-border) bg-(--ui-bg-elevated) p-2">
          <UInput
            v-model="newTaskTitle"
            placeholder="Task title..."
            size="xs"
            class="w-full"
          />
          <USelect
            v-model="newTaskAgentId"
            :items="agentOptions"
            value-key="value"
            placeholder="Select agent..."
            size="xs"
            class="w-full"
          />
          <label class="flex items-center gap-1.5 text-xs text-(--ui-text-toned)">
            <input
              v-model="newTaskWorktree"
              type="checkbox"
              class="rounded border-(--ui-border-accented)"
            >
            Use worktree
          </label>
          <div class="flex gap-1">
            <UButton
              label="Create"
              size="xs"
              color="primary"
              :loading="creatingTask"
              :disabled="!newTaskTitle.trim() || !newTaskAgentId"
              @click="submitNewTask"
            />
            <UButton
              label="Cancel"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="showNewTaskForm = false"
            />
          </div>
        </div>

        <!-- Task list -->
        <div class="space-y-0.5">
          <button
            v-for="task in tasks"
            :key="task.id"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-(--ui-bg-accented)"
            :class="{ 'cursor-pointer': task.status === 'running', 'cursor-default opacity-60': task.status !== 'running' }"
            @click="onTaskClick(task)"
          >
            <span
              class="h-2 w-2 flex-shrink-0 rounded-full"
              :class="taskStatusColor(task.status)"
              :title="task.status"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium text-(--ui-text)">
                {{ task.title }}
              </div>
              <div class="truncate text-[10px] text-(--ui-text-muted)">
                {{ task.agentId }}
              </div>
            </div>
          </button>

          <div
            v-if="tasks.length === 0"
            class="py-2 text-center text-xs text-(--ui-text-dimmed)"
          >
            No tasks yet
          </div>
        </div>
      </div>

      <!-- ============================================================= -->
      <!-- Backlog Section                                                 -->
      <!-- ============================================================= -->
      <div class="border-b border-(--ui-border) px-3 py-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-circle-dot" class="h-4 w-4 flex-shrink-0 text-(--ui-text-muted)" />
            <span class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
              Backlog
            </span>
            <UBadge size="xs" color="neutral" variant="subtle">
              {{ openBeads.length }}
            </UBadge>
          </div>
          <UButton
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="showNewBeadForm = !showNewBeadForm"
          />
        </div>

        <!-- Filter tabs -->
        <div class="mb-2 flex gap-1">
          <button
            v-for="f in (['open', 'in-progress', 'all'] as const)"
            :key="f"
            class="rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
            :class="beadFilter === f
              ? 'bg-(--ui-bg-accented) text-(--ui-text)'
              : 'text-(--ui-text-muted) hover:bg-(--ui-bg-muted)'"
            @click="beadFilter = f"
          >
            {{ f === 'in-progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1) }}
          </button>
        </div>

        <!-- New bead inline form -->
        <div v-if="showNewBeadForm" class="mb-2 space-y-2 rounded-md border border-(--ui-border) bg-(--ui-bg-elevated) p-2">
          <UInput
            v-model="newBeadTitle"
            placeholder="Bead title..."
            size="xs"
            class="w-full"
          />
          <USelect
            v-model="newBeadType"
            :items="beadTypeOptions"
            value-key="value"
            placeholder="Type..."
            size="xs"
            class="w-full"
          />
          <USelect
            v-model="newBeadPriority"
            :items="beadPriorityOptions"
            value-key="value"
            placeholder="Priority..."
            size="xs"
            class="w-full"
          />
          <div class="flex gap-1">
            <UButton
              label="Create"
              size="xs"
              color="primary"
              :loading="creatingBead"
              :disabled="!newBeadTitle.trim()"
              @click="submitNewBead"
            />
            <UButton
              label="Cancel"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="showNewBeadForm = false"
            />
          </div>
        </div>

        <!-- Bead list -->
        <div class="max-h-[200px] space-y-0.5 overflow-y-auto">
          <button
            v-for="bead in filteredBeads"
            :key="bead.id"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-(--ui-bg-accented)"
            :class="{ 'bg-(--ui-bg-accented)': selectedBead?.id === bead.id }"
            @click="selectBead(bead.id)"
          >
            <span
              class="h-2 w-2 flex-shrink-0 rounded-full"
              :class="beadStatusColor(bead.status)"
              :title="bead.status"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1">
                <span class="truncate text-xs font-medium text-(--ui-text)">
                  {{ bead.title }}
                </span>
              </div>
              <div class="flex items-center gap-1">
                <span class="rounded bg-(--ui-bg-muted) px-1 text-[9px] text-(--ui-text-muted)">
                  {{ bead.type }}
                </span>
                <span
                  v-if="priorityLabel(bead.priority)"
                  class="text-[9px] font-semibold"
                  :class="priorityColor(bead.priority)"
                >
                  {{ priorityLabel(bead.priority) }}
                </span>
              </div>
            </div>
          </button>

          <div
            v-if="filteredBeads.length === 0"
            class="py-2 text-center text-xs text-(--ui-text-dimmed)"
          >
            No beads
          </div>
        </div>

        <!-- Bead detail panel -->
        <div
          v-if="selectedBead"
          class="mt-2 space-y-2 rounded-md border border-(--ui-border) bg-(--ui-bg-elevated) p-2"
        >
          <div class="flex items-start justify-between gap-1">
            <div class="min-w-0 flex-1">
              <div class="text-xs font-semibold text-(--ui-text)">
                {{ selectedBead.title }}
              </div>
              <div class="mt-0.5 flex items-center gap-1.5">
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="beadStatusColor(selectedBead.status)"
                />
                <span class="text-[10px] text-(--ui-text-muted)">
                  {{ selectedBead.status }}
                </span>
                <span class="rounded bg-(--ui-bg-muted) px-1 text-[9px] text-(--ui-text-muted)">
                  {{ selectedBead.type }}
                </span>
                <span
                  v-if="priorityLabel(selectedBead.priority)"
                  class="text-[9px] font-semibold"
                  :class="priorityColor(selectedBead.priority)"
                >
                  {{ priorityLabel(selectedBead.priority) }}
                </span>
              </div>
            </div>
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="closeBeadDetail"
            />
          </div>

          <p
            v-if="selectedBead.description"
            class="text-[10px] leading-relaxed text-(--ui-text-toned)"
          >
            {{ selectedBead.description }}
          </p>

          <!-- Blocked by -->
          <div v-if="selectedBead.blockedBy?.length" class="text-[10px] text-(--ui-text-muted)">
            <span class="font-medium">Blocked by:</span>
            {{ selectedBead.blockedBy.join(', ') }}
          </div>

          <!-- Blocks -->
          <div v-if="selectedBead.blocks?.length" class="text-[10px] text-(--ui-text-muted)">
            <span class="font-medium">Blocks:</span>
            {{ selectedBead.blocks.join(', ') }}
          </div>

          <!-- Assignee -->
          <div class="flex items-center gap-1">
            <UInput
              v-model="detailAssignee"
              placeholder="Assignee..."
              size="xs"
              class="flex-1"
              @keyup.enter="updateDetailAssignee"
            />
            <UButton
              icon="i-lucide-check"
              size="xs"
              color="neutral"
              variant="ghost"
              title="Set assignee"
              @click="updateDetailAssignee"
            />
          </div>

          <!-- Actions -->
          <div class="flex gap-1">
            <UButton
              v-if="selectedBead.status !== 'closed'"
              label="Close"
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-check-circle"
              @click="closeSelectedBead"
            />
          </div>
        </div>
      </div>

      <!-- ============================================================= -->
      <!-- Plugins Section                                                 -->
      <!-- ============================================================= -->
      <div class="border-b border-(--ui-border) px-3 py-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-puzzle" class="h-4 w-4 flex-shrink-0 text-(--ui-text-muted)" />
            <span class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
              Plugins
            </span>
          </div>
          <NuxtLink to="/plugins">
            <UButton
              icon="i-lucide-grid-2x2"
              size="xs"
              color="neutral"
              variant="ghost"
              title="Browse all plugins"
            />
          </NuxtLink>
        </div>

        <div class="space-y-0.5">
          <button
            v-for="plugin in visualPlugins"
            :key="plugin.id"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-(--ui-bg-accented)"
            @click="onPluginClick(plugin.id)"
          >
            <UIcon
              :name="plugin.icon || 'i-lucide-puzzle'"
              class="h-4 w-4 flex-shrink-0 text-(--ui-text-muted)"
            />
            <span class="truncate text-xs font-medium text-(--ui-text)">
              {{ plugin.name }}
            </span>
          </button>

          <div
            v-if="visualPlugins.length === 0"
            class="py-2 text-center text-xs text-(--ui-text-dimmed)"
          >
            No visual plugins
          </div>
        </div>
      </div>

      <!-- ============================================================= -->
      <!-- Context Section                                                 -->
      <!-- ============================================================= -->
      <div class="px-3 py-3">
        <div class="mb-2 flex items-center gap-1.5">
          <UIcon name="i-lucide-layers" class="h-4 w-4 flex-shrink-0 text-(--ui-text-muted)" />
          <span class="text-xs font-semibold uppercase tracking-wider text-(--ui-text-muted)">
            Context
          </span>
        </div>

        <!-- Session counts -->
        <div class="mb-2 flex items-center gap-3 text-xs text-(--ui-text-toned)">
          <span class="flex items-center gap-1">
            <span class="h-1.5 w-1.5 rounded-full bg-blue-500" />
            {{ sharedSessionCount }} shared
          </span>
          <span class="flex items-center gap-1">
            <span class="h-1.5 w-1.5 rounded-full bg-orange-500" />
            {{ isolatedSessionCount }} isolated
          </span>
        </div>

        <!-- Beads stats widget -->
        <div class="rounded-md border border-(--ui-border) bg-(--ui-bg-elevated) p-2">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-(--ui-text-muted)">
              Beads
            </span>
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="connected ? 'bg-green-500' : 'bg-red-500'"
              :title="connected ? 'Connected' : 'Disconnected'"
            />
          </div>
          <div class="grid grid-cols-3 gap-1 text-center">
            <div>
              <div class="text-sm font-semibold text-(--ui-text)">{{ beadsOpen }}</div>
              <div class="text-[10px] text-(--ui-text-muted)">Open</div>
            </div>
            <div>
              <div class="text-sm font-semibold text-yellow-600 dark:text-yellow-400">{{ beadsInProgress }}</div>
              <div class="text-[10px] text-(--ui-text-muted)">Active</div>
            </div>
            <div>
              <div class="text-sm font-semibold text-(--ui-text)">{{ beadsClosed }}</div>
              <div class="text-[10px] text-(--ui-text-muted)">Closed</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
