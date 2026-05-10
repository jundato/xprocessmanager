<template>
  <div class="chat-item" :class="[
    { collapsed: !expanded },
    chat.status === 'errored' ? 'has-errored'
      : chat.status === 'stopped' ? 'has-stopped'
      : (chat.needsInput && !focused) ? 'has-needs-input'
      : 'has-thinking'
  ]">
    <div class="chat-item-header" @click="expanded = !expanded">
      <i class="fa-solid chat-caret" :class="expanded ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
      <span class="chat-instruction-text" :title="chat.title || chat.instruction">{{ chat.title || chat.instruction }}</span>
      <span v-if="chat.status === 'errored'" class="chat-status errored" title="Errored">
        <i class="fa-solid fa-triangle-exclamation"></i>
      </span>
      <span v-else-if="chat.status === 'stopped'" class="chat-status stopped" title="Stopped">
        <i class="fa-solid fa-circle-stop"></i>
      </span>
      <template v-else-if="!focused">
        <span v-if="chat.needsInput" class="chat-status needs-input" title="Awaiting input">
          <i class="fa-solid fa-keyboard"></i>
        </span>
        <span v-else class="chat-status thinking" title="Thinking">
          <i class="fa-solid fa-spinner fa-spin"></i>
        </span>
      </template>
      <button class="chat-refresh" @click.stop="refresh" title="Refit terminal & redraw">
        <i class="fa-solid fa-arrows-rotate"></i>
      </button>
      <button class="chat-close" @click.stop="$emit('close', chat.chatId)" title="Close chat">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div
      class="chat-item-body"
      :class="{ 'drag-over': dragOver }"
      :aria-hidden="!expanded"
      @focusin="focused = true"
      @focusout="focused = false"
      @dragenter.stop.prevent="onDragEnter"
      @dragover.stop.prevent="onDragOver"
      @dragleave.stop.prevent="onDragLeave"
      @drop.stop.prevent="onDrop"
    >
      <BaseTerminal
        ref="terminalRef"
        :options="{ cursorBlink: true }"
        @ready="onReady"
        @resize="onResize"
        @data="onData"
      />
      <div v-if="dragOver" class="chat-drop-overlay">
        <i class="fa-solid fa-file-import"></i>
        <span>Drop to insert path</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import BaseTerminal from './BaseTerminal.vue'
import { resolveDroppedPaths, shellQuote } from '../composables/useFileDrop'
import { getPanelState, patchPanelState } from '../composables/usePanelState'

const props = defineProps({
  chat: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const parentGuid = props.chat.chatId.split('::')[0]
const savedExpanded = getPanelState(parentGuid)?.chatExpanded?.[props.chat.chatId]
const expanded = ref(savedExpanded ?? true)

watch(expanded, (v) => {
  const cur = getPanelState(parentGuid) || {}
  const chatExpanded = { ...(cur.chatExpanded || {}), [props.chat.chatId]: v }
  patchPanelState(parentGuid, { chatExpanded })
})
const focused = ref(false)
const terminalRef = ref(null)
const dragOver = ref(false)
let dragCounter = 0
let ws = null
let wsRetryTimer = null
let killed = false

function connectWs() {
  disconnectWs()
  if (killed) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${proto}//${location.host}/ws/terminal?id=${encodeURIComponent(props.chat.chatId)}`
  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    // Fit first so xterm has the correct dimensions before the server's
    // buffer replay arrives. Reset clears any prior content so reconnects
    // don't stack a duplicate copy of the history on top of existing content.
    terminalRef.value?.fit()
    terminalRef.value?.write('\x1bc')
  }
  ws.onmessage = (event) => {
    terminalRef.value?.write(event.data)
  }
  ws.onclose = (event) => {
    if (killed) return
    if (event && event.code === 1000) return
    wsRetryTimer = setTimeout(connectWs, 2000)
  }
}

function disconnectWs() {
  if (ws) {
    ws.onclose = null
    try { ws.close() } catch {}
    ws = null
  }
  if (wsRetryTimer) {
    clearTimeout(wsRetryTimer)
    wsRetryTimer = null
  }
}

function onReady() {
  connectWs()
  requestAnimationFrame(() => terminalRef.value?.focus())
}

function onResize({ cols, rows }) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }))
  }
}

function onData(data) {
  if (data === '\x1b[?1;2c' || data === '\x1b[?62;c' || data === '\x1b[?6c') return
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'input', data }))
  }
}

function onDragEnter() {
  dragCounter++
  dragOver.value = true
  if (!expanded.value) expanded.value = true
}
function onDragOver(ev) {
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}
function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    dragOver.value = false
  }
}
async function onDrop(ev) {
  dragCounter = 0
  dragOver.value = false
  const parentGuid = props.chat.chatId.split('::')[0]
  const paths = await resolveDroppedPaths(ev, parentGuid)
  if (paths.length === 0) return
  if (!ws || ws.readyState !== 1) return
  const text = paths.map(shellQuote).join(' ') + ' '
  ws.send(JSON.stringify({ type: 'input', data: text }))
  terminalRef.value?.focus()
}

watch(expanded, (v) => {
  if (v) nextTick(() => terminalRef.value?.fit())
})

onUnmounted(() => {
  disconnectWs()
})

function markKilled() {
  killed = true
  disconnectWs()
}

function expand() {
  expanded.value = true
}

function focus() {
  requestAnimationFrame(() => terminalRef.value?.focus())
}

function refresh() {
  if (!expanded.value) expanded.value = true
  nextTick(() => {
    // Refit recomputes cols/rows from the current container size and
    // emits onResize → server resizes the PTY. Clearing xterm wipes the
    // stale grid so the agent's redraw (Ctrl+L) lands on a clean canvas.
    terminalRef.value?.fit()
    terminalRef.value?.write('\x1bc')
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'input', data: '\x0c' }))
    }
    terminalRef.value?.focus()
  })
}

defineExpose({ markKilled, expand, focus, refresh })
</script>

<style scoped>
.chat-item {
  --accent: var(--text-dim);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  transition:
    flex-grow 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    min-height 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.18s ease,
    box-shadow 0.18s ease;
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  min-height: 200px;
}
.chat-item.collapsed {
  flex-grow: 0;
  min-height: 36px;
}
.chat-item:not(.collapsed) {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  box-shadow: 0 1px 0 0 rgba(0, 0, 0, 0.25), 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}
.chat-item.has-needs-input { --accent: var(--yellow, #fbbf24); }
.chat-item.has-thinking { --accent: var(--blue, #60a5fa); }
.chat-item.has-errored { --accent: var(--red, #f87171); }

.chat-item-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  position: relative;
  transition: background 0.15s ease;
}
.chat-item-header::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.18s ease;
}
.chat-item:not(.collapsed) .chat-item-header::before,
.chat-item.has-needs-input .chat-item-header::before,
.chat-item.has-errored .chat-item-header::before {
  opacity: 1;
}
.chat-item-header:hover {
  background: rgba(255, 255, 255, 0.06);
}
.chat-item:not(.collapsed) .chat-item-header {
  border-bottom: 1px solid var(--border);
}
.chat-caret {
  font-size: 11px;
  color: var(--text-dim);
  width: 12px;
  text-align: center;
  transition: transform 0.2s ease;
}
.chat-item:not(.collapsed) .chat-caret {
  transform: rotate(0deg);
  color: var(--text);
}
.chat-instruction-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}
.chat-status {
  font-size: 12px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
}
.chat-status.errored { color: var(--red, #f87171); }
.chat-status.stopped { color: var(--text-dim); }
.chat-status.needs-input {
  color: var(--yellow, #fbbf24);
  background: color-mix(in srgb, var(--yellow, #fbbf24) 18%, transparent);
  animation: pulse-needs-input 1.4s ease-in-out infinite;
}
.chat-status.thinking { color: var(--blue, #60a5fa); }

@keyframes pulse-needs-input {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--yellow, #fbbf24) 35%, transparent); }
  50%      { box-shadow: 0 0 0 4px color-mix(in srgb, var(--yellow, #fbbf24) 0%, transparent); }
}

.chat-close,
.chat-refresh {
  background: transparent;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1;
  transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}
.chat-close:hover,
.chat-refresh:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}
.chat-refresh {
  opacity: 0;
  pointer-events: none;
}
.chat-item-header:hover .chat-refresh {
  opacity: 1;
  pointer-events: auto;
}
.chat-item-body {
  flex: 1;
  min-height: 0;
  background: #0f1117;
  display: flex;
  position: relative;
  transition: opacity 0.18s ease;
}
.chat-item.collapsed .chat-item-body {
  opacity: 0;
  pointer-events: none;
}
.chat-item-body :deep(.base-terminal-container) {
  flex: 1;
}
.chat-item-body.drag-over {
  outline: 2px dashed color-mix(in srgb, var(--blue, #60a5fa) 70%, transparent);
  outline-offset: -4px;
}
.chat-drop-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(15, 17, 23, 0.78);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
  z-index: 2;
}
.chat-drop-overlay i {
  font-size: 28px;
  color: var(--blue, #60a5fa);
}
</style>
