<template>
  <div
    class="node-panel"
    :class="{ hidden: !nodeName, dragging, 'drag-over': dragOverTerminal }"
    :style="{ height: panelHeight + 'px', left: leftOffset + 'px' }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div
      v-if="node?.type !== 'agent'"
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
    <div class="xterm-content-wrapper">
      <div 
        id="node-panel-workspace"
        class="node-panel-workspace"
        :style="{ 
          width: (workspaceOpen && node?.type === 'agent') ? workspaceWidth + 'px' : '0px', 
          flexShrink: 0, 
          position: 'relative',
          overflow: 'hidden'
        }"
      ></div>
      <div class="xterm-container" @mousedown="focusTerminal">
        <BaseTerminal
          ref="terminalRef"
          :options="{ cursorBlink: true }"
          @ready="onTerminalReady"
          @resize="onTerminalResize"
          @data="onTerminalData"
        />
      </div>
      
      <div v-if="node?.type === 'agent'" class="session-side-panel">
        <div class="session-panel-header">
          Sessions
          <button class="btn-ghost btn-icon" @click="fetchSessions" title="Refresh Sessions">
            <i class="fa-solid fa-rotate"></i>
          </button>
        </div>
        <div v-if="loadingSessions" class="session-loading">Loading...</div>
        <div v-else-if="sessions.length === 0" class="session-empty">No sessions found.</div>
        <div v-else class="session-list">
          <div v-for="s in sessions" :key="s.id" class="session-item" @click="resumeSession(s.id)">
            <div class="session-title">{{ s.title || s.id }}</div>
            <div class="session-time">{{ s.time }}</div>
          </div>
        </div>
      </div>
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
import { useAlert } from '../composables/useAlert'
import { api } from '../composables/useApi'
import { useNotifications } from '../composables/useNotifications'
import { useSessions } from '../composables/useSessions'
import CardActions from './CardActions.vue'
import GitBranchTag from './GitBranchTag.vue'
import BaseTerminal from './BaseTerminal.vue'

const props = defineProps({
  node: { type: Object, default: null },
  panelHeight: { type: Number, default: 400 },
  workspaceOpen: { type: Boolean, default: false },
  terminalWidth: { type: Number, default: 200 },
  workspaceWidth: { type: Number, default: 0 },
  leftOffset: { type: Number, default: 0 },
})


const { addNotification } = useNotifications()
const { showAlert } = useAlert()

const nodeName = computed(() => props.node?.name)

const nodeGuid = computed(() => props.node?.guid)
const emit = defineEmits(['close', 'resize', 'start', 'stop', 'restart', 'open-workspace', 'edit', 'branch-click', 'pull-git', 'push-git'])

const {
  loadingSessions,
  sessions,
  fetchSessions,
  resumeSession
} = useSessions(computed(() => props.node), emit)

onMounted(() => {
  if (props.node?.type === 'agent') {
    fetchSessions()
  }
})



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
  // Push past the click that opened the panel — that click would otherwise
  // win focus back to the source button after we focus the terminal here.
  requestAnimationFrame(() => terminalRef.value?.focus())
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
    requestAnimationFrame(() => terminalRef.value?.focus())
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
.node-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg);
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 30;
  transition: transform 0.2s;
  box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5);
}
.node-panel.hidden {
  transform: translateY(100%);
}
.xterm-content-wrapper {
  display: flex;
  flex: 1;
  min-height: 0;
}
.xterm-container {
  flex: 1;
  min-height: 0;
  background: #0f1117;
}
.session-side-panel {
  width: 260px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.session-panel-header {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  font-weight: 600;
  font-size: 0.85em;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.session-loading, .session-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9em;
}
.session-list {
  flex: 1;
  overflow-y: auto;
}
.session-item {
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background 0.2s;
}
.session-item:hover {
  background: rgba(255, 255, 255, 0.05);
}
.session-item:last-child {
  border-bottom: none;
}
.session-title {
  font-size: 0.9em;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-time {
  font-size: 0.75em;
  color: var(--text-muted);
  margin-top: 4px;
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
