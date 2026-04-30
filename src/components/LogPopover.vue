<template>
  <div
    ref="popoverRef"
    class="log-popover"
    :class="{ visible }"
    :style="style"
    @mouseenter="$emit('cancel-hide')"
    @mouseleave="$emit('schedule-hide')"
  >
    <div class="log-popover-title">
      <div class="card-header-left">
        <i :class="[typeIcon, 'node-type-icon', node?.status]" :title="node?.type"></i>
        <span>Logs — {{ node?.name || name }}</span>
        <GitBranchTag
          v-if="node"
          :node="node"
          @branch-click="$emit('branch-click', $event)"
          @pull-git="(...args) => $emit('pull-git', ...args)"
          @push-git="(...args) => $emit('push-git', ...args)"
        />
      </div>
      <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
        <button class="btn-popover-clear" @click.stop="handleClear" title="Clear logs">
          <i class="fa-solid fa-eraser"></i>
        </button>
        <button
          class="btn-popover-pin"
          :class="{ active: pinned }"
          @click.stop="$emit('toggle-pin')"
          :title="pinned ? 'Unpin popover' : 'Pin popover open'"
        >
          <i class="fa-solid fa-thumbtack"></i>
        </button>
      </div>
    </div>
    <div class="log-popover-body">
      <BaseTerminal 
        ref="terminalRef"
        :options="{ disableStdin: true }"
        @ready="onTerminalReady"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted, nextTick, computed } from 'vue'
import GitBranchTag from './GitBranchTag.vue'
import BaseTerminal from './BaseTerminal.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  name: { type: String, default: '' },
  node: { type: Object, default: null },
  logs: { type: Array, default: () => [] },
  style: { type: Object, default: () => ({}) },
  pinned: { type: Boolean, default: false },
})

const emit = defineEmits(['cancel-hide', 'schedule-hide', 'clear', 'toggle-pin', 'pull-git', 'push-git'])

const popoverRef = ref(null)
const terminalRef = ref(null)
let writtenLogsCount = 0

const TYPE_ICONS = {
  service: 'fa-solid fa-server',
  agent: 'fa-solid fa-robot',
  desk: 'fa-solid fa-desktop',
  script: 'fa-solid fa-scroll',
}

const typeIcon = computed(() => {
  if (!props.node) return 'fa-solid fa-circle'
  return TYPE_ICONS[props.node.type] || 'fa-solid fa-circle'
})

function onTerminalReady() {
  if (props.visible) {
    syncLogs()
  }
}

function handleClear() {
  terminalRef.value?.clear()
  writtenLogsCount = 0
  emit('clear')
}

function syncLogs() {
  if (!terminalRef.value) return
  
  if (props.logs.length < writtenLogsCount) {
    terminalRef.value.clear()
    writtenLogsCount = 0
  }

  const toWrite = props.logs.slice(writtenLogsCount)
  for (const entry of toWrite) {
    let text = entry.text
    if (entry.source === 'stderr' && !text.includes('\x1b[')) {
      text = `\x1b[31m${text}\x1b[0m`
    }
    terminalRef.value.writeln(text)
  }
  writtenLogsCount = props.logs.length
}

watch(() => props.visible, async (isVisible) => {
  if (isVisible) {
    await nextTick()
    terminalRef.value?.fit()
    syncLogs()
  }
})

watch(() => props.logs, () => {
  if (props.visible) {
    syncLogs()
  }
}, { deep: true })

watch(() => props.name, () => {
  terminalRef.value?.clear()
  writtenLogsCount = 0
})

onUnmounted(() => {
})

defineExpose({ popoverRef })
</script>

<style scoped>
.log-popover-body {
  flex: 1;
  min-height: 0;
  background: #0f1117;
}
</style>
