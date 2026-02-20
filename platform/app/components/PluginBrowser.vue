<script setup lang="ts">
const { plugins, loading, error, enablePlugin, disablePlugin, refresh } = usePlugins()

// -----------------------------------------------------------------------
// Filters
// -----------------------------------------------------------------------

const searchQuery = ref('')
const typeFilter = ref<'all' | 'visual' | 'service'>('all')

const typeOptions = [
  { label: 'All', value: 'all' },
  { label: 'Visual', value: 'visual' },
  { label: 'Service', value: 'service' },
]

const filteredPlugins = computed(() => {
  let result = plugins.value

  // Filter by type
  if (typeFilter.value !== 'all') {
    result = result.filter(p => p.type === typeFilter.value)
  }

  // Filter by search
  const query = searchQuery.value.toLowerCase().trim()
  if (query) {
    result = result.filter(p =>
      p.name.toLowerCase().includes(query)
      || p.description.toLowerCase().includes(query),
    )
  }

  return result
})

// -----------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------

const toggling = ref<Set<string>>(new Set())

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
    toggling.value = new Set(toggling.value)
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl p-6">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-(--ui-text)">
        Plugins
      </h1>
      <p class="mt-1 text-sm text-(--ui-text-muted)">
        Discover and manage locally installed plugins.
      </p>
    </div>

    <!-- Toolbar: search + filter + refresh -->
    <div class="mb-6 flex flex-wrap items-center gap-3">
      <UInput
        v-model="searchQuery"
        icon="i-lucide-search"
        placeholder="Search plugins..."
        size="sm"
        class="w-64"
      />

      <USelect
        v-model="typeFilter"
        :items="typeOptions"
        value-key="value"
        size="sm"
        class="w-32"
      />

      <div class="flex-1" />

      <UButton
        icon="i-lucide-refresh-cw"
        size="sm"
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
      class="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ error }}
    </div>

    <!-- Loading state -->
    <div
      v-if="loading && plugins.length === 0"
      class="py-16 text-center text-sm text-(--ui-text-muted)"
    >
      Loading plugins...
    </div>

    <!-- Empty state: no plugins at all -->
    <div
      v-else-if="plugins.length === 0"
      class="rounded-lg border border-dashed border-(--ui-border-accented) p-12 text-center"
    >
      <UIcon name="i-lucide-puzzle" class="mx-auto mb-3 h-12 w-12 text-(--ui-text-dimmed)" />
      <h2 class="text-base font-medium text-(--ui-text-toned)">
        No plugins installed
      </h2>
      <p class="mx-auto mt-2 max-w-md text-sm text-(--ui-text-muted)">
        Create a plugin by adding a directory under <code class="rounded bg-(--ui-bg-muted) px-1.5 py-0.5 text-xs">plugins/</code> with a <code class="rounded bg-(--ui-bg-muted) px-1.5 py-0.5 text-xs">plugin.json</code> manifest.
      </p>
      <div class="mx-auto mt-4 max-w-sm rounded-md bg-(--ui-bg-muted) p-3 text-left text-xs">
        <pre class="text-(--ui-text-toned)">plugins/
  my-plugin/
    plugin.json     # manifest (id, name, type, ...)
    components/     # Vue components (visual plugins)
    server/         # API routes (optional)</pre>
      </div>
    </div>

    <!-- Empty state: no results from filters -->
    <div
      v-else-if="filteredPlugins.length === 0"
      class="py-12 text-center text-sm text-(--ui-text-muted)"
    >
      No plugins match your search.
    </div>

    <!-- Plugin grid -->
    <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard
        v-for="plugin in filteredPlugins"
        :key="plugin.id"
        class="flex flex-col"
      >
        <div class="flex flex-1 flex-col">
          <!-- Top: icon + badges -->
          <div class="mb-3 flex items-start justify-between">
            <div class="flex items-center gap-2">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-(--ui-bg-muted)">
                <UIcon
                  :name="plugin.icon ? `i-lucide-${plugin.icon}` : 'i-lucide-puzzle'"
                  class="h-5 w-5 text-(--ui-text-toned)"
                />
              </div>
              <div>
                <h3 class="text-sm font-semibold text-(--ui-text)">
                  {{ plugin.name }}
                </h3>
                <span class="text-xs text-(--ui-text-dimmed)">
                  v{{ plugin.version }}
                </span>
              </div>
            </div>
            <UBadge
              :label="plugin.type"
              :color="plugin.type === 'visual' ? 'info' : 'neutral'"
              size="xs"
              variant="subtle"
            />
          </div>

          <!-- Description -->
          <p class="mb-3 flex-1 text-xs leading-relaxed text-(--ui-text-toned)">
            {{ plugin.description }}
          </p>

          <!-- Author -->
          <div v-if="plugin.author" class="mb-3">
            <span class="text-xs text-(--ui-text-dimmed)">
              by {{ plugin.author }}
            </span>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-between border-t border-(--ui-border) pt-3">
            <div class="flex items-center gap-2">
              <span
                class="h-2 w-2 rounded-full"
                :class="plugin.enabled ? 'bg-green-500' : 'bg-gray-400'"
              />
              <span class="text-xs text-(--ui-text-muted)">
                {{ plugin.enabled ? 'Enabled' : 'Disabled' }}
              </span>
            </div>
            <UButton
              :label="plugin.enabled ? 'Disable' : 'Enable'"
              size="xs"
              :color="plugin.enabled ? 'neutral' : 'primary'"
              :variant="plugin.enabled ? 'outline' : 'soft'"
              :loading="toggling.has(plugin.id)"
              @click="togglePlugin(plugin.id, plugin.enabled)"
            />
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
