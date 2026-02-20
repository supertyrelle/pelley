<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const tabs = [
  {
    label: 'Providers',
    icon: 'i-lucide-cloud',
    slot: 'providers',
  },
  {
    label: 'Agents',
    icon: 'i-lucide-bot',
    slot: 'agents',
  },
  {
    label: 'Plugins',
    icon: 'i-lucide-puzzle',
    slot: 'plugins',
  },
  {
    label: 'General',
    icon: 'i-lucide-settings',
    slot: 'general',
  },
]
</script>

<template>
  <UModal
    v-model:open="open"
    title="Settings"
    :ui="{
      content: 'sm:max-w-2xl',
    }"
  >
    <UButton
      icon="i-lucide-settings"
      size="xs"
      color="neutral"
      variant="ghost"
      aria-label="Settings"
    />

    <template #body>
      <UTabs :items="tabs" class="w-full">
        <template #providers>
          <div class="py-3">
            <SettingsProvidersTab />
          </div>
        </template>

        <template #agents>
          <div class="py-3">
            <SettingsAgentsTab />
          </div>
        </template>

        <template #plugins>
          <div class="py-3">
            <SettingsPluginsTab />
          </div>
        </template>

        <template #general>
          <div class="py-3">
            <SettingsGeneralTab />
          </div>
        </template>
      </UTabs>
    </template>
  </UModal>
</template>
