<template>
  <div
    class="git-status-badge"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  >
    <button
      class="btn-git-action btn-watch"
      :class="{ active: watching, dirty: watching && count > 0 }"
      @click.stop="toggle"
      :title="watching ? `Watching git status — ${count} modified` : 'Watch git status (poll every 5s)'"
    >
      <i class="fa-solid" :class="watching ? 'fa-eye' : 'fa-eye-slash'"></i>
      <span v-if="watching" class="count">{{ count }}</span>
    </button>
    <div v-if="watching && hovering" class="git-status-tooltip">
      <div class="tooltip-title">
        <template v-if="loading && count === 0">Checking…</template>
        <template v-else-if="error">{{ error }}</template>
        <template v-else-if="count === 0">Working tree clean</template>
        <template v-else>{{ count }} modified file{{ count === 1 ? '' : 's' }}</template>
      </div>
      <div v-if="files.length" class="tooltip-list">
        <div v-for="f in files" :key="f.path" class="tooltip-row">
          <span class="state-tag" :class="f.state">{{ stateLabel(f.state) }}</span>
          <span class="path">{{ f.path }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { api } from '../composables/useApi.js'

const POLL_MS = 5000

const props = defineProps({
  nodeGuid: { type: String, default: null },
})

const watching = ref(false)
const hovering = ref(false)
const loading = ref(false)
const count = ref(0)
const files = ref([])
const error = ref(null)

let timer = null
let inflight = false

async function poll() {
  if (!props.nodeGuid || inflight) return
  inflight = true
  loading.value = true
  try {
    const res = await api(`/api/processes/${encodeURIComponent(props.nodeGuid)}/git/status`)
    if (res?.error) {
      error.value = res.error
      count.value = 0
      files.value = []
    } else {
      error.value = null
      count.value = res.count || 0
      files.value = res.files || []
    }
  } catch (err) {
    error.value = err.message || 'Failed to check status'
  } finally {
    loading.value = false
    inflight = false
  }
}

function start() {
  stop()
  poll()
  timer = setInterval(poll, POLL_MS)
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function toggle() {
  watching.value = !watching.value
  if (watching.value) start()
  else {
    stop()
    count.value = 0
    files.value = []
    error.value = null
  }
}

watch(() => props.nodeGuid, () => {
  if (watching.value) {
    count.value = 0
    files.value = []
    start()
  }
})

onUnmounted(stop)

function stateLabel(s) {
  switch (s) {
    case 'untracked': return 'U'
    case 'staged': return 'S'
    case 'unstaged': return 'M'
    case 'staged+unstaged': return 'SM'
    case 'ignored': return 'I'
    default: return '?'
  }
}
</script>

<style scoped>
.git-status-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.btn-watch {
  gap: 4px;
}
.btn-watch.active {
  color: var(--text);
  border-color: var(--blue);
  background: rgba(96, 165, 250, 0.1);
}
.btn-watch.dirty {
  border-color: var(--orange, #f59e0b);
  background: rgba(245, 158, 11, 0.12);
  color: var(--orange, #f59e0b);
}
.count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 10px;
}
.git-status-tooltip {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 200;
  min-width: 240px;
  max-width: 480px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--surface2, #1a1d28);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  font-size: 11px;
  color: var(--text);
}
.tooltip-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-dim);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.tooltip-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
}
.tooltip-row .path {
  text-overflow: ellipsis;
  overflow: hidden;
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 11px;
}
.state-tag {
  display: inline-block;
  min-width: 22px;
  text-align: center;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}
.state-tag.untracked { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }
.state-tag.staged    { background: rgba(52, 211, 153, 0.2); color: #34d399; }
.state-tag.unstaged  { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
.state-tag\+unstaged,
.state-tag.staged\+unstaged { background: rgba(244, 114, 182, 0.2); color: #f472b6; }
.state-tag.ignored   { background: rgba(100, 116, 139, 0.15); color: #64748b; }
</style>
