<template>
  <div ref="containerRef" class="base-terminal-container"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const props = defineProps({
  options: { type: Object, default: () => ({}) },
  theme: { type: Object, default: null },
})

const emit = defineEmits(['ready', 'resize', 'data'])

const containerRef = ref(null)
let term = null
let fitAddon = null
let resizeObserver = null

const defaultTheme = {
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
}

function initTerminal() {
  if (term || !containerRef.value) return

  term = new Terminal({
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
    theme: props.theme || defaultTheme,
    convertEol: true,
    scrollback: 5000,
    allowProposedApi: true,
    ...props.options
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  
  term.open(containerRef.value)
  
  term.onResize(dims => emit('resize', dims))
  term.onData(data => emit('data', data))

  setupResizeObserver()
  
  nextTick(() => {
    fit()
    emit('ready', term)
  })
}

function fit() {
  if (!fitAddon || !term || !term.element) return
  try {
    const dims = fitAddon.proposeDimensions()
    if (dims && dims.cols > 0 && dims.rows > 0) {
      term.resize(dims.cols, dims.rows)
    }
  } catch (e) {
    console.warn('Terminal fit failed', e)
  }
}

function setupResizeObserver() {
  if (resizeObserver) resizeObserver.disconnect()
  resizeObserver = new ResizeObserver(() => fit())
  if (containerRef.value) resizeObserver.observe(containerRef.value)
}

onMounted(() => {
  initTerminal()
})

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
  if (term) term.dispose()
})

defineExpose({
  write: (data) => term?.write(data),
  writeln: (data) => term?.writeln(data),
  clear: () => term?.clear(),
  focus: () => term?.focus(),
  fit,
  get term() { return term }
})
</script>

<style>
.base-terminal-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.base-terminal-container .xterm {
  padding: 4px;
}
.base-terminal-container .xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
</style>
