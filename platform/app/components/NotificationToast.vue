<script setup lang="ts">
const { notifications, dismiss } = useNotifications()

const iconMap: Record<string, string> = {
  info: 'i-lucide-info',
  success: 'i-lucide-check-circle',
  warning: 'i-lucide-alert-triangle',
  error: 'i-lucide-x-circle',
}

const colorMap = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
} as const
</script>

<template>
  <div class="pointer-events-none fixed inset-0 z-50 flex flex-col items-end justify-end gap-2 p-4">
    <TransitionGroup
      name="toast"
      tag="div"
      class="flex flex-col gap-2"
    >
      <div
        v-for="notif in notifications"
        :key="notif.id"
        class="pointer-events-auto w-80"
      >
        <UAlert
          :icon="iconMap[notif.type]"
          :color="(colorMap[notif.type] as any)"
          :title="notif.title"
          :description="notif.message"
          :close="true"
          close-icon="i-lucide-x"
          @update:open="dismiss(notif.id)"
        />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active {
  transition: all 0.3s ease-out;
}

.toast-leave-active {
  transition: all 0.2s ease-in;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-move {
  transition: transform 0.2s ease;
}
</style>
