<template>
  <div
    class="xterm-panel"
    :class="{ hidden: !nodeName, dragging, 'drag-over': dragOverTerminal }"
    :style="{ height: panelHeight + 'px' }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div
      class="log-resize-handle"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDragTouch"
    ></div>
    <div class="log-header">
      <div class="card-header-left">
        <i :class="[typeIcon, 'node-type-icon', node?.status]" :title="node?.type" style="margin-right: 8px;"></i>
        <span>{{ nodeName }}</span>
        <GitBranchTag
          v-if="node"
          :node="node"
          @branch-click="$emit('branch-click', $event)"
          @pull-git="(...args) => $emit('pull-git', ...args)"
          @push-git="(...args) => $emit('push-git', ...args)"
        />
      </div>
      <CardActions
        v-if="node"
        ref="cardActionsRef"
        data-terminal-actions
        style="margin-left: auto; margin-right: 12px; gap: 8px;"
        :node="node"
        :workspace-open="workspaceOpen"
        :terminal-open="true"
        :show-edit="true"
        @start="$emit('start', $event)"
        @stop="$emit('stop', $event)"
        @restart="$emit('restart', $event)"
        @open-workspace="$emit('open-workspace', $event)"
        @edit="$emit('edit', $event)"
      />
      <button class="btn-ghost btn-icon" @click="$emit('close')" title="Close Terminal">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="xterm-container">
      <BaseTerminal 
        ref="terminalRef"
        :options="{ cursorBlink: true }"
        @ready="onTerminalReady"
        @resize="onTerminalResize"
        @data="onTerminalData"
      />
    </div>
    
    <div
      v-if="dragOverTerminal"
      class="terminal-drop-overlay"
      @dragenter.stop.prevent
      @dragover.stop.prevent
      @dragleave.stop.prevent
      @drop.stop.prevent="onDrop"
    >
      <i class="fa-solid fa-file-import"></i>
      <p>Drop files here to reference in {{ nodeName }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { api } from '../composables/useApi'
import { useNotifications } from '../composables/useNotifications'
import CardActions from './CardActions.vue'
import GitBranchTag from './GitBranchTag.vue'
import BaseTerminal from './BaseTerminal.vue'

const props = defineProps({
  node: { type: Object, default: null },
  panelHeight: { type: Number, default: 400 },
  workspaceOpen: { type: Boolean, default: false },
  terminalWidth: { type: Number, default: 200 },
})

const { addNotification } = useNotifications()

const nodeName = computed(() => props.node?.name)
const nodeGuid = computed(() => props.node?.guid)
const emit = defineEmits(['close', 'resize', 'start', 'stop', 'restart', 'open-workspace', 'edit', 'branch-click', 'pull-git', 'push-git'])

const TYPE_ICONS = {
  service: 'fa-solid fa-server',
  agent: 'fa-solid fa-robot',
  desk: 'fa-solid fa-desktop',
  script: 'fa-solid fa-scroll',
}

const typeIcon = computed(() => TYPE_ICONS[props.node?.type] || 'fa-solid fa-circle')

const terminalRef = ref(null)
const dragging = ref(false)
const cardActionsRef = ref(null)
let ws = null
let wsRetryTimer = null

function onTerminalReady() {
  if (nodeGuid.value) {
    connectWs(nodeGuid.value)
  }
}

function onTerminalResize({ cols, rows }) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }))
  }
}

function onTerminalData(data) {
  if (data === '\x1b[?1;2c' || data === '\x1b[?62;c' || data === '\x1b[?6c') {
    return
  }
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'input', data }))
  }
}

function focusTerminal() {
  terminalRef.value?.focus()
}

function connectWs(id) {
  disconnectWs()
  if (!id) return

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${proto}//${location.host}/ws/terminal?id=${id}`
  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    console.log(`[xpm] Connected to ${id}`)
    terminalRef.value?.fit()
  }

  ws.onmessage = (event) => {
    terminalRef.value?.write(event.data)
  }

  ws.onclose = () => {
    console.log(`[xpm] Disconnected from ${id}`)
    if (nodeGuid.value === id) {
      wsRetryTimer = setTimeout(() => connectWs(id), 2000)
    }
  }
}

function disconnectWs() {
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
  if (wsRetryTimer) {
    clearTimeout(wsRetryTimer)
    wsRetryTimer = null
  }
}

watch(() => nodeGuid.value, (guid) => {
  if (guid) {
    connectWs(guid)
    terminalRef.value?.clear()
  } else {
    disconnectWs()
  }
})

watch(() => props.panelHeight, () => {
  nextTick(() => terminalRef.value?.fit())
})

onUnmounted(() => {
  disconnectWs()
})

// File Drag & Drop: insert dropped files' absolute paths into the terminal.
const dragOverTerminal = ref(false)

function onDragEnter() { dragOverTerminal.value = true }
function onDragLeave() { dragOverTerminal.value = false }
function onDragOver() {}

// POSIX-safe shell quoting. Single-quote the path and escape embedded quotes.
function shellQuote(p) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(p)) return p
  return `'${p.replace(/'/g, `'\\''`)}'`
}

// Browsers don't expose absolute paths from Finder/Explorer drags. The server
// resolves the dropped filename against the node's cwd and returns the
// absolute path, which we then insert into the terminal.
async function onDrop(ev) {
  dragOverTerminal.value = false
  const files = ev.dataTransfer?.files
  if (!files || files.length === 0 || !nodeGuid.value) return

  const resolved = []
  for (const file of files) {
    try {
      const result = await api(
        `/api/processes/${encodeURIComponent(nodeGuid.value)}/file-path`,
        'POST',
        { path: file.name }
      )
      if (result?.fullPath) resolved.push(result.fullPath)
      else throw new Error(result?.error || 'no path returned')
    } catch (err) {
      addNotification(`Could not resolve path for ${file.name}: ${err.message}`, 'error')
    }
  }
  if (resolved.length === 0) return

  const text = resolved.map(shellQuote).join(' ') + ' '
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'input', data: text }))
    terminalRef.value?.focus()
  }
}

function startDrag() {
  dragging.value = true
  const onMove = (ev) => emit('resize', window.innerHeight - ev.clientY)
  const onUp = () => {
    dragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function startDragTouch() {
  dragging.value = true
  const onMove = (ev) => emit('resize', window.innerHeight - ev.touches[0].clientY)
  const onEnd = () => {
    dragging.value = false
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
  }
  document.addEventListener('touchmove', onMove)
  document.addEventListener('touchend', onEnd)
}
</script>

<style scoped>
.xterm-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--surface);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 20;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5);
}
.xterm-panel.hidden {
  transform: translateY(100%);
}
.xterm-container {
  flex: 1;
  min-height: 0;
  background: #0f1117;
}
.terminal-drop-overlay {
  position: absolute;
  top: 40px; left: 0; right: 0; bottom: 0;
  background: rgba(15, 17, 23, 0.9);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  z-index: 100; border: 2px dashed var(--blue);
  margin: 8px; border-radius: 8px; color: var(--blue);
}
</style>
