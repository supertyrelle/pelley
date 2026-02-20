<script setup lang="ts">
const { plugins, loading, error, enablePlugin, disablePlugin, refresh } = usePlugins()
const { addPanel } = useTilingLayout()

const expandedId = ref<string | null>(null)
const toggling = ref<Set<string>>(new Set())

function toggleExpanded(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

async function togglePlugin(id: string, currentlyEnabled: boolean) {
  toggling.value.add(id)
  try {
    if (currentlyEnabled) {
      await disablePlugin(id)
    }
    else {
      await enablePlugin(id)
    }
  }
  finally {
    toggling.value.delete(id)
    // Trigger reactivity
    toggling.value = new Set(toggling.value)
  }
}

function openInPanel(pluginId: string) {
  addPanel(pluginId)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <p class="text-xs text-(--ui-text-muted)">
        Plugins discovered from the <code class="rounded bg-(--ui-bg-muted) px-1 py-0.5">plugins/</code> directory.
      </p>
      <UButton
        icon="i-lucide-refresh-cw"
        size="xs"
        color="neutral"
        variant="ghost"
        label="Refresh"
        :loading="loading"
        @click="refresh()"
      />
    </div>

    <!-- Error state -->
    <div
      v-if="error"
      class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ error }}
    </div>

    <!-- Loading state -->
    <div
      v-if="loading && plugins.length === 0"
      class="py-8 text-center text-sm text-(--ui-text-muted)"
    >
      Loading plugins...
    </div>

    <!-- Empty state -->
    <div
      v-else-if="plugins.length === 0"
      class="rounded-md border border-dashed border-(--ui-border-accented) p-6 text-center"
    >
      <UIcon name="i-lucide-puzzle" class="mx-auto mb-2 h-8 w-8 text-(--ui-text-dimmed)" />
      <p class="text-sm text-(--ui-text-muted)">
        No plugins found.
      </p>
      <p class="mt-1 text-xs text-(--ui-text-dimmed)">
        Add plugins to the <code class="rounded bg-(--ui-bg-muted) px-1 py-0.5">plugins/</code> directory with a <code class="rounded bg-(--ui-bg-muted) px-1 py-0.5">plugin.json</code> manifest.
      </p>
    </div>

    <!-- Plugin list -->
    <div v-else class="space-y-2">
      <UCard v-for="plugin in plugins" :key="plugin.id">
        <!-- Main row -->
        <div class="flex items-center gap-3">
          <!-- Icon -->
          <UIcon
            :name="plugin.icon ? `i-lucide-${plugin.icon}` : 'i-lucide-puzzle'"
            class="h-5 w-5 flex-shrink-0 text-(--ui-text-muted)"
          />

          <!-- Name + description (clickable to expand) -->
          <button
            class="min-w-0 flex-1 text-left"
            @click="toggleExpanded(plugin.id)"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-(--ui-text)">
                {{ plugin.name }}
              </span>
              <UBadge
                :label="plugin.type"
                :color="plugin.type === 'visual' ? 'info' : 'neutral'"
                size="xs"
                variant="subtle"
              />
              <span class="text-xs text-(--ui-text-dimmed)">
                v{{ plugin.version }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-xs text-(--ui-text-muted)">
              {{ plugin.description }}
            </p>
          </button>

          <!-- Status + toggle -->
          <div class="flex flex-shrink-0 items-center gap-3">
            <span
              class="h-2 w-2 rounded-full"
              :class="plugin.enabled ? 'bg-green-500' : 'bg-gray-400'"
            />
            <USwitch
              :model-value="plugin.enabled"
              size="sm"
              :loading="toggling.has(plugin.id)"
              @update:model-value="togglePlugin(plugin.id, plugin.enabled)"
            />
          </div>
        </div>

        <!-- Expanded details -->
        <div
          v-if="expandedId === plugin.id"
          class="mt-3 border-t border-(--ui-border) pt-3"
        >
          <dl class="space-y-2 text-xs">
            <div v-if="plugin.author">
              <dt class="font-medium text-(--ui-text-muted)">Author</dt>
              <dd class="text-(--ui-text-toned)">{{ plugin.author }}</dd>
            </div>

            <div v-if="plugin.entryComponent">
              <dt class="font-medium text-(--ui-text-muted)">Entry Component</dt>
              <dd class="font-mono text-(--ui-text-toned)">{{ plugin.entryComponent }}</dd>
            </div>

            <div v-if="plugin.modelConfig">
              <dt class="font-medium text-(--ui-text-muted)">Model Defaults</dt>
              <dd class="space-y-0.5 text-(--ui-text-toned)">
                <div v-if="plugin.modelConfig.defaultProvider">
                  Provider: <span class="font-mono">{{ plugin.modelConfig.defaultProvider }}</span>
                </div>
                <div v-if="plugin.modelConfig.defaultModel">
                  Model: <span class="font-mono">{{ plugin.modelConfig.defaultModel }}</span>
                </div>
                <div v-if="plugin.modelConfig.systemPrompt">
                  System prompt: <span class="italic">{{ plugin.modelConfig.systemPrompt.slice(0, 100) }}{{ plugin.modelConfig.systemPrompt.length > 100 ? '...' : '' }}</span>
                </div>
              </dd>
            </div>
          </dl>

          <!-- Open in panel (visual plugins only) -->
          <div v-if="plugin.type === 'visual' && plugin.enabled" class="mt-3">
            <UButton
              icon="i-lucide-layout-panel-left"
              size="xs"
              color="primary"
              variant="soft"
              label="Open in Panel"
              @click="openInPanel(plugin.id)"
            />
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
