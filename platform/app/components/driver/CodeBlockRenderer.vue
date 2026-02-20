<script setup lang="ts">
const props = withDefaults(defineProps<{
  code: string
  language?: string
  filename?: string
  showLineNumbers?: boolean
  maxHeight?: string
}>(), {
  showLineNumbers: false,
  maxHeight: '400px',
})

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const langMap: Record<string, string> = {
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
  html: 'html',
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
  toml: 'toml',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
}

function getLangFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return langMap[ext] ?? 'plaintext'
}

const resolvedLanguage = computed(() => {
  if (props.language) return props.language
  if (props.filename) return getLangFromFilename(props.filename)
  return 'plaintext'
})

const displayLanguage = computed(() => {
  return resolvedLanguage.value.charAt(0).toUpperCase() + resolvedLanguage.value.slice(1)
})

// ---------------------------------------------------------------------------
// Code lines (for line numbers)
// ---------------------------------------------------------------------------

const lines = computed(() => props.code.split('\n'))

// ---------------------------------------------------------------------------
// Copy to clipboard
// ---------------------------------------------------------------------------

const copied = ref(false)
let copyTimeout: ReturnType<typeof setTimeout> | null = null

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    if (copyTimeout) clearTimeout(copyTimeout)
    copyTimeout = setTimeout(() => { copied.value = false }, 2000)
  }
  catch {
    // Clipboard API may be unavailable in some contexts
  }
}

onUnmounted(() => {
  if (copyTimeout) clearTimeout(copyTimeout)
})
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-(--ui-border)">
    <!-- Header bar -->
    <div class="flex items-center justify-between bg-(--ui-bg-elevated) px-3 py-1.5">
      <span class="text-xs font-medium text-(--ui-text-muted)">
        {{ displayLanguage }}
      </span>

      <span
        v-if="filename"
        class="truncate px-4 text-xs text-(--ui-text-dimmed)"
      >
        {{ filename }}
      </span>

      <UButton
        :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
        size="xs"
        color="neutral"
        variant="ghost"
        :label="copied ? 'Copied!' : ''"
        @click="copyCode"
      />
    </div>

    <!-- Code area -->
    <div
      class="overflow-auto bg-(--ui-bg-accented)"
      :style="{ maxHeight }"
    >
      <table class="w-full border-collapse">
        <tbody>
          <tr v-for="(line, index) in lines" :key="index">
            <!-- Line numbers -->
            <td
              v-if="showLineNumbers"
              class="select-none border-r border-(--ui-border) px-3 py-0 text-right align-top font-mono text-xs leading-6 text-(--ui-text-dimmed)"
            >
              {{ index + 1 }}
            </td>

            <!-- Code content -->
            <td class="w-full px-4 py-0 font-mono text-xs leading-6 text-(--ui-text)">
              <pre class="whitespace-pre">{{ line }}</pre>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
