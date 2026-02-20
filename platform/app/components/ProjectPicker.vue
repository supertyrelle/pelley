<script setup lang="ts">
import type { Project } from '~~/shared/types/project'

const open = defineModel<boolean>('open', { default: false })

const { projects, activeProject, addProject, switchProject, refresh } = useProjects()

// -----------------------------------------------------------------------
// Add project form
// -----------------------------------------------------------------------

const showAddForm = ref(false)
const newProjectPath = ref('')
const adding = ref(false)
const addError = ref<string | null>(null)

const derivedName = computed(() => {
  const path = newProjectPath.value.trim()
  if (!path) return ''
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] ?? ''
})

async function submitAddProject() {
  const path = newProjectPath.value.trim()
  if (!path || !derivedName.value) return

  adding.value = true
  addError.value = null

  try {
    const project = await addProject(derivedName.value, path)
    // Auto-activate the newly added project
    await switchProject(project.id)
    // Reset form
    newProjectPath.value = ''
    showAddForm.value = false
  }
  catch (err: unknown) {
    addError.value = err instanceof Error ? err.message : 'Failed to add project'
  }
  finally {
    adding.value = false
  }
}

async function selectProject(project: Project) {
  try {
    await switchProject(project.id)
  }
  catch (err: unknown) {
    console.error('[ProjectPicker] Failed to switch project:', err)
  }
}

function dismiss() {
  if (activeProject.value) {
    open.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :close="!!activeProject"
    :prevent-close="!activeProject"
  >
    <template #content>
      <div class="p-6">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-(--ui-text)">
            Select Project
          </h2>
          <UButton
            v-if="activeProject"
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="dismiss"
          />
        </div>

        <p
          v-if="!activeProject"
          class="mb-4 text-sm text-(--ui-text-muted)"
        >
          No active project. Select or add a project to get started.
        </p>

        <!-- Project list -->
        <div v-if="projects.length > 0" class="mb-4 space-y-1">
          <button
            v-for="project in projects"
            :key="project.id"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-(--ui-bg-accented)"
            :class="{ 'bg-(--ui-bg-elevated) ring-1 ring-(--ui-border-accented)': activeProject?.id === project.id }"
            @click="selectProject(project)"
          >
            <UIcon
              name="i-lucide-folder"
              class="h-5 w-5 flex-shrink-0 text-(--ui-text-muted)"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-(--ui-text)">
                {{ project.name }}
              </div>
              <div class="truncate text-xs text-(--ui-text-muted)">
                {{ project.path }}
              </div>
            </div>
            <UIcon
              v-if="activeProject?.id === project.id"
              name="i-lucide-check"
              class="h-4 w-4 flex-shrink-0 text-green-500"
            />
          </button>
        </div>

        <div
          v-else
          class="mb-4 rounded-lg border border-dashed border-(--ui-border) p-4 text-center text-sm text-(--ui-text-dimmed)"
        >
          No projects registered yet. Add one below.
        </div>

        <!-- Add project form -->
        <div v-if="showAddForm" class="space-y-3 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) p-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-(--ui-text-muted)">
              Directory path
            </label>
            <UInput
              v-model="newProjectPath"
              placeholder="/path/to/your/project"
              size="sm"
              class="w-full"
              @keyup.enter="submitAddProject"
            />
          </div>

          <div v-if="derivedName" class="text-xs text-(--ui-text-muted)">
            Project name: <span class="font-medium text-(--ui-text)">{{ derivedName }}</span>
          </div>

          <div v-if="addError" class="text-xs text-red-500">
            {{ addError }}
          </div>

          <div class="flex gap-2">
            <UButton
              label="Add Project"
              size="sm"
              color="primary"
              :loading="adding"
              :disabled="!newProjectPath.trim()"
              @click="submitAddProject"
            />
            <UButton
              label="Cancel"
              size="sm"
              color="neutral"
              variant="ghost"
              @click="showAddForm = false; addError = null"
            />
          </div>
        </div>

        <UButton
          v-else
          icon="i-lucide-plus"
          label="Add Project"
          size="sm"
          color="neutral"
          variant="soft"
          class="w-full"
          @click="showAddForm = true"
        />
      </div>
    </template>
  </UModal>
</template>
