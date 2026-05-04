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
      <div class="log-popover-terminal">
        <BaseTerminal
          ref="terminalRef"
          :options="{ disableStdin: true }"
          @ready="onTerminalReady"
        />
      </div>
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
let ws = null
let terminalReady = false

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

function connectWs(guid) {
  disconnectWs()
  if (!guid) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${proto}//${location.host}/ws/terminal?id=${guid}`)
  ws.onmessage = (event) => terminalRef.value?.write(event.data)
  ws.onerror = () => {}
  ws.onclose = () => { ws = null }
}

function disconnectWs() {
  if (ws) {
    ws.onmessage = null
    ws.onclose = null
    ws.close()
    ws = null
  }
}

async function onTerminalReady() {
  terminalReady = true
  if (props.visible && props.node?.guid) {
    await nextTick()
    terminalRef.value?.fit()
    connectWs(props.node.guid)
  }
}

function handleClear() {
  terminalRef.value?.clear()
  emit('clear')
}

watch(() => props.visible, async (isVisible) => {
  if (isVisible) {
    await nextTick()
    terminalRef.value?.fit()
    if (terminalReady && props.node?.guid) connectWs(props.node.guid)
  } else {
    disconnectWs()
  }
})

watch(() => props.node?.guid, (guid) => {
  terminalRef.value?.clear()
  if (props.visible && terminalReady && guid) connectWs(guid)
})

onUnmounted(() => {
  disconnectWs()
})

defineExpose({ popoverRef })
</script>

<style scoped>
.log-popover-body {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  background: #0f1117;
}
.log-popover-terminal {
  width: 100vw;
  height: 100%;
}
</style>
