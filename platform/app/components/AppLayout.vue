<script setup lang="ts">
const sidebarCollapsed = useState('sidebar-collapsed', () => false)

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

defineExpose({ toggleSidebar })
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden">
    <AppSidebar
      v-model:collapsed="sidebarCollapsed"
    />

    <!-- Main content area -->
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="min-h-0 flex-1">
        <slot />
      </div>
      <InfoBar />
    </div>
  </div>
</template>
