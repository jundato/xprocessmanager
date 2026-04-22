<template>
  <div
    class="xterm-panel"
    :class="{ hidden: !nodeName, dragging }"
    :style="{ height: panelHeight + 'px' }"
    @dragover.prevent
    @drop.prevent
  >
    <div
      class="log-resize-handle"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDragTouch"
    ></div>
    <div class="log-header">
      <span>Terminal — {{ nodeName }}</span>
      <div class="log-actions" style="margin-left: auto; display: flex; gap: 8px; margin-right: 12px; align-items: center">
        <template v-if="node?.status === 'running'">
          <button class="btn-stop btn-icon" @click="$emit('stop', node?.name)" title="Stop"><i class="fa-solid fa-stop"></i></button>
          <button class="btn-restart btn-icon" @click="$emit('restart', node?.name)" title="Restart"><i class="fa-solid fa-rotate-right"></i></button>
        </template>
        <template v-else>
          <button class="btn-start btn-icon" @click="$emit('start', node?.name)" title="Start"><i class="fa-solid fa-play"></i></button>
          <div v-if="node?.type === 'agent' && isGemini" class="session-dropdown-container">
            <button class="btn-sessions btn-icon" @click.stop="toggleSessions" title="Resume Session">
              <i class="fa-solid fa-history"></i>
            </button>
            <div v-if="showSessions" class="session-dropdown" @click.stop>
              <div class="session-dropdown-header">
                Recent Sessions
                <button class="btn-close-sessions" @click="showSessions = false">&times;</button>
              </div>
              <div v-if="loadingSessions" class="session-loading">Loading...</div>
              <div v-else-if="sessions.length === 0" class="session-empty">No sessions found.</div>
              <div v-else class="session-list">
                <div v-for="s in sessions" :key="s.id" class="session-item" @click="resumeSession(s.id)">
                  <div class="session-title">{{ s.title }}</div>
                  <div class="session-time">{{ s.time }}</div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
      <button class="btn-ghost" @click="$emit('close')" title="Close Terminal">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div
      ref="termContainerRef"
      class="xterm-container"
      :class="{ 'drag-over': dragOverTerminal }"
      tabindex="0"
      @click="focusTerminal"
      @dragenter.prevent.stop="onDragEnter"
      @dragover.prevent.stop="onDragOver"
      @dragleave.prevent.stop="onDragLeave"
      @drop.prevent.stop="onDrop"
    ></div>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { api } from '../composables/useApi'

const props = defineProps({
  node: { type: Object, default: null },
  panelHeight: { type: Number, default: 400 },
})

const nodeName = computed(() => props.node?.name)
const emit = defineEmits(['close', 'resize', 'start', 'stop', 'restart'])

const isGemini = computed(() => {
  const cmd = String(props.node?.command || '').toLowerCase()
  return cmd.includes('gemini')
})

const showSessions = ref(false)
const loadingSessions = ref(false)
const sessions = ref([])

import { useAlert } from '../composables/useAlert.js'
const { showAlert } = useAlert()

async function toggleSessions() {
  showSessions.value = !showSessions.value
  if (showSessions.value) {
    loadingSessions.value = true
    try {
      sessions.value = await api(`/api/processes/${encodeURIComponent(nodeName.value)}/sessions`)
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
      showAlert('Error', 'Failed to fetch sessions.')
    } finally {
      loadingSessions.value = false
    }
  }
}

async function resumeSession(sessionId) {
  try {
    const result = await api(`/api/processes/${encodeURIComponent(nodeName.value)}/resume/${sessionId}`, 'POST')
    if (result && result.staleSession) {
      try {
        sessions.value = await api(`/api/processes/${encodeURIComponent(nodeName.value)}/sessions`)
      } catch {}
      showAlert('Session unavailable', result.error)
      return
    }
    if (result && result.error) {
      showAlert('Error', `Failed to resume session: ${result.error}`)
      return
    }
    showSessions.value = false
    emit('start', nodeName.value)
  } catch (err) {
    console.error('Failed to resume session:', err)
    showAlert('Error', `Failed to resume session: ${err.message}`)
  }
}

const termContainerRef = ref(null)
const dragging = ref(false)
const dragOverTerminal = ref(false)
let dragCounter = 0

let term = null
let fitAddon = null
let ws = null
let resizeObserver = null

function createTerminal() {
  if (term) {
    if (termContainerRef.value && !term.element) {
      term.open(termContainerRef.value)
      setupResizeObserver()
      fitWide()
    }
    return
  }
  if (!termContainerRef.value) return

  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
    theme: {
      background: '#0f1117',
      foreground: '#e1e4ed',
      cursor: '#60a5fa',
      selectionBackground: 'rgba(96, 165, 250, 0.3)',
      black: '#1a1d27',
      red: '#f87171',
      green: '#34d399',
      yellow: '#fbbf24',
      blue: '#60a5fa',
      magenta: '#a78bfa',
      cyan: '#22d3ee',
      white: '#e1e4ed',
      brightBlack: '#8b8fa3',
      brightRed: '#fca5a5',
      brightGreen: '#6ee7b7',
      brightYellow: '#fde68a',
      brightBlue: '#93c5fd',
      brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9',
      brightWhite: '#f8fafc',
    },
    allowProposedApi: true,
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(new WebLinksAddon())

  // ALWAYS open before anything else
  term.open(termContainerRef.value)
  setupResizeObserver()

  // Send terminal size changes to server
  term.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    }
  })

  // Send keyboard input to server
  term.onData((data) => {
    // Filter out automatic terminal identification responses that can cause loops
    // especially with processes that echo stdin or are not in raw mode.
    if (data === '\x1b[?1;2c' || data === '\x1b[?62;c' || data === '\x1b[?6c') {
      return
    }
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'input', data }))
    }
  })

  fitWide()
}

function setupResizeObserver() {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  if (!termContainerRef.value) return
  resizeObserver = new ResizeObserver(() => {
    fitWide()
  })
  resizeObserver.observe(termContainerRef.value)
}

function focusTerminal() {
  if (term) {
    term.focus()
  }
}

function destroyTerminal() {
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null }
  if (term) { term.dispose(); term = null; fitAddon = null }
}

let wsRetryTimer = null

function connectWs(name) {
  disconnectWs()
  if (!name) return

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${location.host}/ws/terminal?name=${encodeURIComponent(name)}`
  const localWs = new WebSocket(url)
  ws = localWs

  localWs.onopen = () => {
    if (term) {
      fitWide()
      nextTick(() => term.focus())
    }
  }

  localWs.onmessage = (ev) => {
    if (ws === localWs && term) term.write(ev.data)
  }

  localWs.onclose = () => {
    if (ws !== localWs) return
    ws = null
    if (nodeName.value === name) {
      wsRetryTimer = setTimeout(() => connectWs(name), 1500)
    }
  }
  localWs.onerror = () => {}
}

function disconnectWs() {
  if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null }
  if (ws) { ws.close(); ws = null }
}

// When node status changes to running, attempt to reconnect immediately.
// If the PTY isn't ready yet, the onclose retry loop will keep trying every 1500ms.
watch(() => props.node?.status, (status, oldStatus) => {
  if (status === 'running' && oldStatus !== 'running' && nodeName.value) {
    connectWs(nodeName.value)
  }
})

// When nodeName changes, reconnect
watch(nodeName, async (name, oldName) => {
  if (name && name !== oldName) {
    if (!term) createTerminal()
    else { term.clear(); fitWide() }
    connectWs(name)
    await nextTick()
    focusTerminal()
  } else if (!name) {
    disconnectWs()
  }
}, { immediate: false })

const WIDE_COLS = 200

function fitWide() {
  if (!fitAddon || !term || !term.element) return
  const dims = fitAddon.proposeDimensions()
  if (dims && dims.cols > 0 && dims.rows > 0) {
    term.resize(WIDE_COLS, dims.rows)
  } else {
    // Retry once if zero dimensions (often means container not yet visible)
    setTimeout(() => {
      if (!fitAddon || !term) return
      const d2 = fitAddon.proposeDimensions()
      if (d2 && d2.cols > 0 && d2.rows > 0) term.resize(WIDE_COLS, d2.rows)
    }, 50)
  }
}

// Refit when panel height changes
watch(() => props.panelHeight, () => {
  nextTick(() => fitWide())
})

onMounted(() => {
  if (nodeName.value) {
    createTerminal()
    connectWs(nodeName.value)
    nextTick(() => {
      fitWide()
      focusTerminal()
    })
  }
})

onUnmounted(() => {
  disconnectWs()
  destroyTerminal()
})

// Drag resize (same pattern as LogPanel)
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

// File Drag & Drop
function onDragEnter(ev) {
  dragCounter++
  dragOverTerminal.value = true
}

function onDragOver(ev) {
  if (ev.dataTransfer) {
    ev.dataTransfer.dropEffect = 'copy'
  }
}

function onDragLeave() {
  dragCounter--
  if (dragCounter === 0) {
    dragOverTerminal.value = false
  }
}

async function onDrop(ev) {
  dragCounter = 0
  dragOverTerminal.value = false
  const files = ev.dataTransfer?.files
  if (!files.length || !nodeName.value) return

  for (const file of files) {
    try {
      if (term) term.write(`\r\n\x1b[33m[xpm] Uploading ${file.name}...\x1b[0m\r\n`)
      
      const isImage = file.type.startsWith('image/')
      let content
      let encoding = 'utf-8'

      if (isImage) {
        content = await readFileAsBase64(file)
        encoding = 'base64'
      } else {
        content = await readFileAsText(file)
      }

      await api(`/api/processes/${encodeURIComponent(nodeName.value)}/file`, 'PUT', {
        path: file.name,
        content,
        encoding
      })

      if (term) {
        term.write(`\x1b[32m[xpm] Uploaded ${file.name} successfully.\x1b[0m\r\n`)
        term.write(`\x1b[36m[xpm] You can now reference it with @${file.name}\x1b[0m\r\n`)
        term.focus()
        // Automatically start typing the reference for convenience
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'input', data: `@${file.name} ` }))
        }
      }
    } catch (err) {
      if (term) term.write(`\x1b[31m[xpm] Failed to upload ${file.name}: ${err.message}\x1b[0m\r\n`)
    }
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read binary file'))
    reader.readAsDataURL(file)
  })
}
</script>
