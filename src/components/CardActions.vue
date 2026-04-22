<template>
  <div
    class="card-actions"
    @mouseenter="$emit('hover-cancel', node.name)"
    @mouseleave="$emit('hover-enter', node.name, cardRef, expanded, node.command)"
  >
    <template v-if="node.status === 'running' && !isSelected">
      <button class="btn-stop btn-icon" @click.stop="$emit('stop', node.name)" title="Stop"><i class="fa-solid fa-stop"></i></button>
      <button class="btn-restart btn-icon" @click.stop="$emit('restart', node.name)" title="Restart"><i class="fa-solid fa-rotate-right"></i></button>
    </template>
    <template v-else-if="!isSelected">
      <button class="btn-start btn-icon" @click.stop="$emit('start', node.name)" title="Start"><i class="fa-solid fa-play"></i></button>
      <div v-if="node.type === 'agent' && isGemini" class="session-dropdown-container">
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
    <button v-if="node.cwd && (isSelected ? !terminalOpen : true)" class="btn-icon btn-workspace" :class="{ active: workspaceOpen }" @click.stop="$emit('open-workspace', node)" title="Toggle Workspace">
      <i :class="node.type === 'agent' ? 'fa-solid fa-laptop-code' : 'fa-solid fa-folder-open'"></i>
    </button>
    <div v-if="tools.length > 0 && !isSelected" class="tools-dropdown-container">
      <button class="btn-icon btn-tools" @click.stop="toggleTools" title="Tools">
        <i class="fa-solid fa-screwdriver-wrench"></i>
      </button>
      <div v-if="showTools" class="tools-dropdown" @click.stop>
        <div class="tools-dropdown-header">Tools</div>
        <div class="tools-list">
          <div v-for="t in tools" :key="t.label" class="tool-item" @click="runTool(t)">
            <i class="fa-solid fa-gear tool-icon"></i>
            <span>{{ t.label }}</span>
            <i v-if="t.requiresParam" class="fa-solid fa-keyboard tool-param-icon" title="Requires parameter"></i>
          </div>
        </div>
      </div>
    </div>
    <button v-if="showEdit" class="btn-gear" @click.stop="$emit('edit', node.name)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '../composables/useApi.js'
import { useAlert } from '../composables/useAlert.js'
import { useTasks } from '../composables/useTasks.js'

const props = defineProps({
  node: { type: Object, required: true },
  isSelected: { type: Boolean, default: false },
  terminalOpen: { type: Boolean, default: false },
  workspaceOpen: { type: Boolean, default: false },
  cardRef: { type: Object, default: null },
  expanded: { type: Boolean, default: false },
  showEdit: { type: Boolean, default: true },
})

const emit = defineEmits(['start', 'stop', 'restart', 'edit', 'open-workspace', 'hover-cancel', 'hover-enter'])

const { showAlert } = useAlert()
const { executeTool } = useTasks()

const isGemini = computed(() => {
  const cmd = String(props.node.command || '').toLowerCase()
  return cmd.includes('gemini')
})

const showSessions = ref(false)
const loadingSessions = ref(false)
const sessions = ref([])

const showTools = ref(false)
const tools = ref([])

async function fetchTools() {
  try {
    tools.value = await api('/api/tools')
  } catch (err) {
    console.error('Failed to fetch tools:', err)
  }
}

onMounted(() => {
  fetchTools()
  document.addEventListener('click', closeDropdowns)
})

onUnmounted(() => {
  document.removeEventListener('click', closeDropdowns)
})

function closeDropdowns() {
  showSessions.value = false
  showTools.value = false
}

function toggleTools() {
  const current = showTools.value
  closeDropdowns()
  showTools.value = !current
}

async function runTool(tool) {
  let param = ''
  if (tool.requiresParam) {
    param = prompt(`Enter parameter for ${tool.label}:`)
    if (param === null) return // cancelled
  }
  showTools.value = false
  await executeTool(props.node.name, tool, param)
}

async function toggleSessions() {
  const current = showSessions.value
  closeDropdowns()
  showSessions.value = !current
  if (showSessions.value) {
    loadingSessions.value = true
    try {
      sessions.value = await api(`/api/processes/${encodeURIComponent(props.node.name)}/sessions`)
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
    const result = await api(`/api/processes/${encodeURIComponent(props.node.name)}/resume/${sessionId}`, 'POST')
    if (result && result.staleSession) {
      try {
        sessions.value = await api(`/api/processes/${encodeURIComponent(props.node.name)}/sessions`)
      } catch {}
      showAlert('Session unavailable', result.error)
      return
    }
    if (result && result.error) {
      showAlert('Error', `Failed to resume session: ${result.error}`)
      return
    }
    showSessions.value = false
    emit('start', props.node.name)
  } catch (err) {
    console.error('Failed to resume session:', err)
    showAlert('Error', `Failed to resume session: ${err.message}`)
  }
}
</script>
