<script setup lang="ts">
const props = defineProps<{
  projectPath: string
  baseBranch?: string
}>()

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <UModal
    v-model:open="open"
    title="Git Changes"
    :ui="{
      width: 'sm:max-w-6xl',
    }"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium">Git Changes</span>
        <span
          v-if="props.baseBranch"
          class="rounded bg-(--ui-bg-muted) px-1.5 py-0.5 text-xs text-(--ui-text-toned)"
        >
          {{ props.baseBranch }}
        </span>
      </div>
    </template>

    <template #body>
      <DiffViewer
        :project-path="props.projectPath"
        :base-branch="props.baseBranch"
        class="h-[70vh]"
      />
    </template>
  </UModal>
</template>
