<script setup lang="ts">
const { panels, removePanel, resizePanel, setActivePanel, resetWidths } = useTilingLayout()

const isDragging = ref(false)
const containerRef = ref<HTMLElement | null>(null)

// Track which panel index is being resized (the left panel of the handle)
const dragIndex = ref(-1)
const dragStartX = ref(0)
const dragStartWidths = ref<number[]>([])

function onHandleMouseDown(index: number, e: MouseEvent) {
  e.preventDefault()
  isDragging.value = true
  dragIndex.value = index
  dragStartX.value = e.clientX
  dragStartWidths.value = panels.value.map(p => p.widthPercent)

  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!containerRef.value || dragIndex.value < 0) return

  const containerWidth = containerRef.value.clientWidth
  const deltaX = e.clientX - dragStartX.value
  const deltaPercent = (deltaX / containerWidth) * 100

  const leftOriginal = dragStartWidths.value[dragIndex.value] ?? 0
  const rightOriginal = dragStartWidths.value[dragIndex.value + 1] ?? 0

  const minPercent = (300 / containerWidth) * 100
  const combined = leftOriginal + rightOriginal

  let newLeft = leftOriginal + deltaPercent
  let newRight = combined - newLeft

  // clamp both sides to minimum
  if (newLeft < minPercent) {
    newLeft = minPercent
    newRight = combined - minPercent
  }
  if (newRight < minPercent) {
    newRight = minPercent
    newLeft = combined - minPercent
  }

  const dragPanel = panels.value[dragIndex.value]
  if (!dragPanel) return
  resizePanel(dragPanel.id, newLeft)
}

function onMouseUp() {
  isDragging.value = false
  dragIndex.value = -1
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

function onHandleReset(index: number) {
  // reset just the two adjacent panels to equal share of their combined width
  const left = panels.value[index]
  const right = panels.value[index + 1]
  if (!left || !right) return
  const combined = left.widthPercent + right.widthPercent
  const half = combined / 2
  resizePanel(left.id, half)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})
</script>

<template>
  <div
    ref="containerRef"
    class="tiling-layout flex h-full w-full"
    :class="{ 'is-dragging': isDragging }"
  >
    <template v-for="(panel, index) in panels" :key="panel.id">
      <div
        class="tiling-panel flex flex-col overflow-hidden border-(--ui-border)"
        :class="{
          'ring-2 ring-(--ui-border-accented) ring-inset': panel.isActive,
          'border-r': index < panels.length - 1,
          'transition-[width] duration-300 ease-in-out': !isDragging,
        }"
        :style="{ width: `${panel.widthPercent}%` }"
      >
        <PanelHeader
          :panel="panel"
          :panel-type="panel.panelType"
          @close="removePanel(panel.id)"
          @activate="setActivePanel(panel.id)"
        />

        <div class="flex-1 overflow-hidden">
          <slot :panel="panel" :index="index" />
        </div>
      </div>

      <!-- Resize handle between panels -->
      <div
        v-if="index < panels.length - 1"
        class="panel-handle group relative hidden flex-shrink-0 cursor-col-resize select-none md:flex"
        @mousedown="onHandleMouseDown(index, $event)"
        @dblclick="onHandleReset(index)"
      >
        <div class="absolute inset-y-0 -left-1.5 -right-1.5 z-10" />
        <div
          class="h-full w-1 bg-(--ui-border) transition-colors"
          :class="{
            'bg-(--ui-border-accented)': isDragging && dragIndex === index,
            'group-hover:bg-(--ui-border-accented)': !(isDragging && dragIndex === index),
          }"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* On narrow viewports, stack vertically */
@media (max-width: 767px) {
  .tiling-layout {
    flex-direction: column;
  }

  .tiling-panel {
    width: 100% !important;
    border-right: none !important;
    border-bottom: 1px solid;
    border-color: inherit;
  }

  .tiling-panel:last-of-type {
    border-bottom: none;
  }
}
</style>
