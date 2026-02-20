<script setup lang="ts">
import { DiffView, DiffModeEnum, DiffFile as DiffFileModel } from '@git-diff-view/vue'
import '@git-diff-view/vue/styles/diff-view.css'
import type { DiffFile, ChangedFile } from '~~/shared/types/diff'

const props = defineProps<{
  projectPath: string
  baseBranch?: string
}>()

const viewMode = ref<'split' | 'unified'>('unified')
const selectedFile = ref<string | null>(null)

// Fetch changed file list
const { data: changedFiles, status: changedFilesStatus } = useFetch<ChangedFile[]>(
  '/api/git/changed-files',
  {
    query: computed(() => ({
      projectPath: props.projectPath,
      baseBranch: props.baseBranch,
    })),
  },
)

// Fetch diff data
const { data: diffFiles, status: diffStatus } = useFetch<DiffFile[]>(
  '/api/git/diff',
  {
    query: computed(() => ({
      projectPath: props.projectPath,
      branch: props.baseBranch,
    })),
  },
)

const isLoading = computed(() => changedFilesStatus.value === 'pending' || diffStatus.value === 'pending')

// Auto-select first file when data loads
watch(changedFiles, (files) => {
  if (files?.length && !selectedFile.value) {
    selectedFile.value = files[0]!.path
  }
}, { immediate: true })

// Find the diff for the selected file
const selectedDiff = computed(() => {
  if (!selectedFile.value || !diffFiles.value) return null
  return diffFiles.value.find(d => d.path === selectedFile.value) ?? null
})

// Build the DiffFile model for @git-diff-view
const diffFileModel = computed(() => {
  if (!selectedDiff.value) return null

  const raw = selectedDiff.value.rawDiff
  // Extract hunks from the raw diff -- everything from the first @@ onward
  const hunkStart = raw.indexOf('@@')
  if (hunkStart === -1) return null

  const hunksRaw = raw.slice(hunkStart)
  // Split into individual hunk strings (each starts with @@)
  const hunks = hunksRaw.split(/(?=^@@)/m).filter(Boolean)

  const fileName = selectedDiff.value.path
  const lang = getLangFromPath(fileName)

  try {
    const instance = DiffFileModel.createInstance({
      oldFile: {
        fileName: selectedDiff.value.oldPath ?? fileName,
        fileLang: lang,
        content: null,
      },
      newFile: {
        fileName,
        fileLang: lang,
        content: null,
      },
      hunks,
    })
    instance.init()
    instance.buildSplitDiffLines()
    instance.buildUnifiedDiffLines()
    return instance
  }
  catch {
    return null
  }
})

const diffViewMode = computed(() => {
  return viewMode.value === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified
})

// Status icon/color for file list
function statusIcon(status: ChangedFile['status']): string {
  switch (status) {
    case 'A': return '+'
    case 'D': return '-'
    case 'M': return '~'
    case 'R': return '>'
    default: return '?'
  }
}

function statusColor(status: ChangedFile['status']): string {
  switch (status) {
    case 'A': return 'text-green-500'
    case 'D': return 'text-red-500'
    case 'M': return 'text-blue-500'
    case 'R': return 'text-yellow-500'
    default: return 'text-(--ui-text-dimmed)'
  }
}

function getLangFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    vue: 'vue',
    py: 'python',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'xml',
    xml: 'xml',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    dockerfile: 'dockerfile',
    toml: 'ini',
  }
  return map[ext] ?? 'plaintext'
}

// Stats for the selected diff
const diffStats = computed(() => {
  if (!selectedDiff.value) return null
  return {
    additions: selectedDiff.value.additions,
    deletions: selectedDiff.value.deletions,
  }
})

// Total stats across all files
const totalStats = computed(() => {
  if (!diffFiles.value) return { additions: 0, deletions: 0, files: 0 }
  return {
    additions: diffFiles.value.reduce((sum, f) => sum + f.additions, 0),
    deletions: diffFiles.value.reduce((sum, f) => sum + f.deletions, 0),
    files: diffFiles.value.length,
  }
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- Toolbar -->
    <div class="flex items-center justify-between border-b border-(--ui-border) px-3 py-2">
      <div class="flex items-center gap-3">
        <span class="text-xs text-(--ui-text-muted)">
          {{ totalStats.files }} file{{ totalStats.files !== 1 ? 's' : '' }}
        </span>
        <span class="text-xs text-green-600 dark:text-green-400">
          +{{ totalStats.additions }}
        </span>
        <span class="text-xs text-red-600 dark:text-red-400">
          -{{ totalStats.deletions }}
        </span>
      </div>

      <div class="flex items-center gap-1">
        <UButton
          size="xs"
          :variant="viewMode === 'unified' ? 'solid' : 'ghost'"
          color="neutral"
          label="Unified"
          @click="viewMode = 'unified'"
        />
        <UButton
          size="xs"
          :variant="viewMode === 'split' ? 'solid' : 'ghost'"
          color="neutral"
          label="Split"
          @click="viewMode = 'split'"
        />
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex flex-1 items-center justify-center">
      <span class="text-sm text-(--ui-text-dimmed)">Loading diff...</span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!changedFiles?.length"
      class="flex flex-1 items-center justify-center"
    >
      <span class="text-sm text-(--ui-text-dimmed)">No changes</span>
    </div>

    <!-- Content -->
    <div v-else class="flex flex-1 overflow-hidden">
      <!-- File sidebar -->
      <div class="w-56 flex-shrink-0 overflow-y-auto border-r border-(--ui-border)">
        <button
          v-for="file in changedFiles"
          :key="file.path"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-(--ui-bg-accented)"
          :class="{
            'bg-(--ui-bg-muted)': selectedFile === file.path,
          }"
          @click="selectedFile = file.path"
        >
          <span
            class="w-3 flex-shrink-0 text-center font-mono font-bold"
            :class="statusColor(file.status)"
          >
            {{ statusIcon(file.status) }}
          </span>
          <span class="truncate text-(--ui-text-toned)">
            {{ file.path.split('/').pop() }}
          </span>
        </button>
      </div>

      <!-- Diff pane -->
      <div class="flex-1 overflow-auto">
        <!-- File header -->
        <div
          v-if="selectedFile"
          class="sticky top-0 z-10 flex items-center gap-3 border-b border-(--ui-border) bg-(--ui-bg) px-3 py-1.5"
        >
          <span class="text-xs font-medium text-(--ui-text-toned)">
            {{ selectedFile }}
          </span>
          <span v-if="diffStats" class="text-xs text-green-600 dark:text-green-400">
            +{{ diffStats.additions }}
          </span>
          <span v-if="diffStats" class="text-xs text-red-600 dark:text-red-400">
            -{{ diffStats.deletions }}
          </span>
        </div>

        <!-- Rich diff view -->
        <DiffView
          v-if="diffFileModel"
          :diff-file="diffFileModel"
          :diff-view-mode="diffViewMode"
          :diff-view-wrap="true"
          :diff-view-font-size="12"
          :diff-view-highlight="true"
          class="diff-view-container"
        />

        <!-- Fallback: raw diff -->
        <pre
          v-else-if="selectedDiff"
          class="overflow-auto p-3 font-mono text-xs leading-5"
        ><template v-for="(line, i) in selectedDiff.rawDiff.split('\n')" :key="i"><span
  :class="{
    'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300': line.startsWith('+') && !line.startsWith('+++'),
    'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300': line.startsWith('-') && !line.startsWith('---'),
    'text-blue-600 dark:text-blue-400': line.startsWith('@@'),
    'text-(--ui-text-muted)': line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++'),
  }"
>{{ line }}
</span></template></pre>

        <!-- No selection -->
        <div
          v-else
          class="flex h-full items-center justify-center text-sm text-(--ui-text-dimmed)"
        >
          Select a file to view its diff
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Scope diff-view styles to avoid leaking */
.diff-view-container {
  font-size: 12px;
}
</style>
