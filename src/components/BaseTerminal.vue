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
let fitTimer = null

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
  const el = containerRef.value
  if (!el) return
  // Skip when hidden/collapsed — fitting against a 0×0 container collapses
  // the PTY to a minimum size and forces TUIs to re-render at that width.
  const rect = el.getBoundingClientRect()
  if (rect.width < 20 || rect.height < 20) return
  try {
    fitAddon.fit()
  } catch (e) {
    console.warn('Terminal fit failed', e)
  }
}

function scheduleFit() {
  // Coalesce ResizeObserver bursts during expand/collapse animations so the
  // PTY isn't resized every animation frame (which would make the agent
  // redraw repeatedly at intermediate widths).
  if (fitTimer) clearTimeout(fitTimer)
  fitTimer = setTimeout(() => { fitTimer = null; fit() }, 80)
}

function setupResizeObserver() {
  if (resizeObserver) resizeObserver.disconnect()
  resizeObserver = new ResizeObserver(() => scheduleFit())
  if (containerRef.value) resizeObserver.observe(containerRef.value)
}

onMounted(() => {
  initTerminal()
})

onUnmounted(() => {
  if (fitTimer) { clearTimeout(fitTimer); fitTimer = null }
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
