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
        <GitStatusBadge
          v-if="node?.branch"
          :node-guid="nodeGuid"
          style="margin-left: 6px;"
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
        :in-panel="true"
        @start="$emit('start', $event)"
        @stop="$emit('stop', $event)"
        @restart="$emit('restart', $event)"
        @open-workspace="$emit('open-workspace', $event)"
        @edit="$emit('edit', $event)"
        @chat="onOpenChatModal"
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
      <div ref="xtermContainerRef" class="xterm-container" @mousedown="focusTerminal">
        <template v-if="node?.type === 'agent'">
          <div v-if="loadingChats" class="chat-empty">Loading chats…</div>
          <div v-else-if="chats.length === 0" class="chat-empty">
            <i class="fa-solid fa-comment-dots chat-empty-icon"></i>
            <p>No chats yet. Click <i class="fa-solid fa-comment-dots"></i> in the header to start one.</p>
          </div>
          <div v-else class="chat-stack">
            <ChatItem
              v-for="c in chats"
              :key="c.chatId"
              :ref="(el) => registerChatRef(c.chatId, el)"
              :chat="c"
              @close="onCloseChat"
            />
          </div>
        </template>
        <BaseTerminal
          v-else
          ref="terminalRef"
          :options="{ cursorBlink: true }"
          @ready="onTerminalReady"
          @resize="onTerminalResize"
          @data="onTerminalData"
        />
      </div>

      <div
        v-if="node?.type === 'agent'"
        class="session-side-panel"
        :class="{ collapsed: sessionPanelCollapsed }"
      >
        <div class="session-panel-header">
          <template v-if="!sessionPanelCollapsed">
            <span class="session-panel-title">Sessions</span>
            <div class="session-panel-actions">
              <button class="btn-ghost btn-icon" @click="fetchSessions" title="Refresh Sessions">
                <i class="fa-solid fa-rotate"></i>
              </button>
              <button class="btn-ghost btn-icon" @click="sessionPanelCollapsed = true" title="Hide Sessions">
                <i class="fa-solid fa-chevron-right"></i>
              </button>
            </div>
          </template>
          <button
            v-else
            class="btn-ghost btn-icon"
            @click="sessionPanelCollapsed = false"
            title="Show Sessions"
          >
            <i class="fa-solid fa-chevron-left"></i>
          </button>
        </div>
        <template v-if="!sessionPanelCollapsed">
          <div v-if="loadingSessions" class="session-loading">Loading...</div>
          <div v-else-if="sessions.length === 0" class="session-empty">No sessions found.</div>
          <div v-else class="session-list">
            <div v-for="s in sessions" :key="s.id" class="session-item" @click="resumeSession(s)">
              <div class="session-title">{{ s.title || s.id }}</div>
              <div class="session-time">{{ s.time }}</div>
            </div>
          </div>
        </template>
      </div>
    </div>
    
    <div
      v-if="dragOverTerminal && node?.type !== 'agent'"
      class="terminal-drop-overlay"
      @dragenter.stop.prevent
      @dragover.stop.prevent
      @dragleave.stop.prevent
      @drop.stop.prevent="onDrop"
    >
      <i class="fa-solid fa-file-import"></i>
      <p>Drop files here to reference in {{ nodeName }}</p>
    </div>
    <ChatModal
      :show="chatModalOpen"
      :submitting="chatSubmitting"
      @ok="onChatOk"
      @cancel="chatModalOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useAlert } from '../composables/useAlert'
import { api } from '../composables/useApi'
import { useSessions } from '../composables/useSessions'
import { useChats } from '../composables/useChats'
import CardActions from './CardActions.vue'
import GitBranchTag from './GitBranchTag.vue'
import GitStatusBadge from './GitStatusBadge.vue'
import BaseTerminal from './BaseTerminal.vue'
import ChatItem from './ChatItem.vue'
import ChatModal from './ChatModal.vue'
import { resolveDroppedPaths, shellQuote as droppedShellQuote } from '../composables/useFileDrop'
import { getPanelState, patchPanelState } from '../composables/usePanelState'

const props = defineProps({
  node: { type: Object, default: null },
  panelHeight: { type: Number, default: 400 },
  workspaceOpen: { type: Boolean, default: false },
  terminalWidth: { type: Number, default: 200 },
  workspaceWidth: { type: Number, default: 0 },
  leftOffset: { type: Number, default: 0 },
})


const { showAlert } = useAlert()

const nodeName = computed(() => props.node?.name)

const nodeGuid = computed(() => props.node?.guid)
const emit = defineEmits(['close', 'resize', 'start', 'stop', 'restart', 'open-workspace', 'edit', 'branch-click', 'pull-git', 'push-git'])

const {
  chats,
  loading: loadingChats,
  fetchChats,
  spawnChat,
  killChat,
  startPolling: startChatsPolling,
  stopPolling: stopChatsPolling
} = useChats(nodeGuid)

const {
  loadingSessions,
  sessions,
  fetchSessions,
  resumeSession
} = useSessions(computed(() => props.node), emit, spawnChat, {
  chats,
  getChatRef: (chatId) => chatRefs.get(chatId),
  getInitialPtySize: estimateInitialPtySize,
})

const chatModalOpen = ref(false)
const chatSubmitting = ref(false)
const chatRefs = new Map()
const xtermContainerRef = ref(null)
const sessionPanelCollapsed = ref(getPanelState(props.node?.guid)?.sessionPanelCollapsed ?? false)

watch(sessionPanelCollapsed, (v) => {
  const guid = nodeGuid.value
  if (guid) patchPanelState(guid, { sessionPanelCollapsed: v })
})

// Estimate the cols/rows the new chat's xterm will end up at, so the PTY
// is spawned at the matching size. Without this, the PTY's first render
// (e.g. claude --resume replaying the transcript) is captured at a wrong
// width and the buffer replay garbles when xterm renders it narrower.
function estimateInitialPtySize() {
  const el = xtermContainerRef.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width < 50 || rect.height < 50) return null
  // SF Mono / Fira Code at 13px ≈ 7.8px advance, ~17px line height.
  const CHAR_W = 7.8
  const ROW_H = 17
  const HEADER_H = 36   // ChatItem header
  const PADDING = 8     // xterm internal padding (~4px each side)
  const projectedCount = (chats.value?.length || 0) + 1
  const perChatHeight = Math.max(rect.height / projectedCount, 200)
  const usableHeight = perChatHeight - HEADER_H - PADDING
  const usableWidth = rect.width - PADDING
  const cols = Math.max(40, Math.floor(usableWidth / CHAR_W))
  const rows = Math.max(10, Math.floor(usableHeight / ROW_H))
  return { cols, rows }
}

function registerChatRef(chatId, el) {
  if (el) chatRefs.set(chatId, el)
  else chatRefs.delete(chatId)
}

function onOpenChatModal() {
  chatModalOpen.value = true
}

async function onChatOk(instruction) {
  chatSubmitting.value = true
  try {
    const size = estimateInitialPtySize()
    await spawnChat({
      instruction,
      ...(size ? { cols: size.cols, rows: size.rows } : {}),
    })
    chatModalOpen.value = false
  } catch (err) {
    showAlert('Error', `Failed to start chat: ${err.message}`)
  } finally {
    chatSubmitting.value = false
  }
}

async function onCloseChat(chatId) {
  const ref = chatRefs.get(chatId)
  ref?.markKilled?.()
  await killChat(chatId)
}

watch(nodeGuid, (guid) => {
  if (guid && props.node?.type === 'agent') {
    sessionPanelCollapsed.value = getPanelState(guid)?.sessionPanelCollapsed ?? false
    fetchChats()
    startChatsPolling()
  } else {
    chats.value = []
    stopChatsPolling()
  }
}, { immediate: false })

onMounted(() => {
  if (props.node?.type === 'agent') {
    fetchSessions()
    fetchChats()
    startChatsPolling()
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
    // Reset terminal before the server replays its buffer, so reconnects
    // don't stack a duplicate copy of the history on top of existing content.
    terminalRef.value?.write('\x1bc')
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
  if (guid && props.node?.type !== 'agent') {
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
  stopChatsPolling()
})

// File Drag & Drop: insert dropped files' absolute paths into the terminal.
const dragOverTerminal = ref(false)

function onDragEnter() { dragOverTerminal.value = true }
function onDragLeave() { dragOverTerminal.value = false }
function onDragOver() {}

// For agent nodes the panel itself has no terminal — each chat handles its
// own drop. For non-agent nodes, resolve real OS paths when exposed and
// otherwise upload the file bytes to the server's drop tmp dir.
async function onDrop(ev) {
  dragOverTerminal.value = false
  if (props.node?.type === 'agent') return
  if (!nodeGuid.value) return

  const paths = await resolveDroppedPaths(ev, nodeGuid.value)
  if (paths.length === 0) return

  const text = paths.map(droppedShellQuote).join(' ') + ' '
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
  min-height: 0;
  height: 100%;
  transition: width 0.15s ease;
}
.session-side-panel.collapsed {
  width: 32px;
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
.session-side-panel.collapsed .session-panel-header {
  justify-content: center;
  padding: 8px 4px;
}
.session-panel-title {
  flex: 1;
}
.session-panel-actions {
  display: flex;
  gap: 2px;
}
.session-loading, .session-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9em;
}
.session-list {
  flex: 1;
  min-height: 0;
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
.chat-stack {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
}
.chat-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}
.chat-empty-icon {
  font-size: 32px;
  opacity: 0.4;
}


</style>
