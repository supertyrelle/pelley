<template>
  <AppLayout>
    <div class="flex h-full flex-col">
      <!-- Top bar -->
      <header class="flex h-12 flex-shrink-0 items-center justify-between border-b border-(--ui-border) bg-(--ui-bg-elevated) px-4">
        <div class="flex items-center gap-2">
          <NuxtLink
            to="/"
            class="text-sm text-(--ui-text-muted) hover:text-(--ui-text-toned)"
          >
            pelley
          </NuxtLink>
          <UIcon name="i-lucide-chevron-right" class="h-3 w-3 text-(--ui-text-dimmed)" />
          <h1 class="text-sm font-semibold text-(--ui-text-toned)">
            Plugins
          </h1>
        </div>

        <NuxtLink to="/">
          <UButton
            icon="i-lucide-arrow-left"
            size="xs"
            color="neutral"
            variant="ghost"
            label="Back"
          />
        </NuxtLink>
      </header>

      <!-- Plugin browser content -->
      <div class="flex-1 overflow-y-auto">
        <PluginBrowser />
      </div>
    </div>
  </AppLayout>
</template>
