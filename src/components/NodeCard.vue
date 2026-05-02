<template>
  <div
    ref="cardRef"
    class="card"
    :class="{ selected: isSelected, expanded, stopped: node.status !== 'running' }"
    :style="{ borderColor, '--card-color': borderColor }"
    @click="$emit('select', node.guid)"
    @mouseenter="$emit('hover-enter', node.guid, $event.currentTarget, expanded, node.command, node)"
    @mouseleave="!expanded && $emit('hover-leave', node.guid)"
  >
    <div class="card-name-badge">
      <i :class="[typeIcon, 'node-type-icon', node.status]" :title="node.type"></i>
      {{ node.name }}
      <i v-if="node.type === 'script' && node.status === 'running'" class="fa-solid fa-spinner script-running-spinner" title="Running..."></i>
      <i v-if="node.needsInput" class="fa-solid fa-keyboard fa-fade" style="color: #fbbf24;" title="Waiting for input..."></i>
    </div>
    <div class="card-header">
      <div class="card-header-left">
        <div v-if="agentTag" class="agent-tag-wrapper">
          <span class="agent-tag">
            <img :src="agentTag.icon" class="agent-tag-icon" :alt="agentTag.name" />
            {{ agentTag.name }}
          </span>
        </div>
        <GitBranchTag
          :node="node"
          @branch-click="$emit('branch-click', $event)"
          @pull-git="(...args) => $emit('pull-git', ...args)"
          @push-git="(...args) => $emit('push-git', ...args)"
        />
      </div>
      <div class="card-header-right">
        <div class="card-meta-info">
          <span class="pid-badge" title="PID"><i class="fa-solid fa-hashtag mr-1"></i>{{ node.pid || '-' }}</span>
          <span title="Uptime"><i class="fa-regular fa-clock mr-1"></i>{{ uptime }}</span>
        </div>
        <CardActions
          :node="node"
          :is-selected="isSelected"
          :terminal-open="terminalOpen"
          :workspace-open="workspaceOpen"
          :card-ref="cardRef"
          :expanded="expanded"
          @start="$emit('start', $event)"
          @stop="$emit('stop', $event)"
          @restart="$emit('restart', $event)"
          @edit="$emit('edit', $event)"
          @open-workspace="$emit('open-workspace', $event)"
          @hover-cancel="$emit('hover-cancel', $event)"
          @hover-enter="(name, el, exp, cmd) => $emit('hover-enter', name, el, exp, cmd)"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { api } from '../composables/useApi.js'
import { useNotifications } from '../composables/useNotifications.js'
import CardActions from './CardActions.vue'
import GitBranchTag from './GitBranchTag.vue'

import geminiIcon from '../assets/gemini.svg'
import cursorIcon from '../assets/cursor.svg'
import claudeIcon from '../assets/claude.svg'

const props = defineProps({
  node: { type: Object, required: true },
  borderColor: { type: String, default: '#4b5563' },
  isSelected: { type: Boolean, default: false },
  terminalOpen: { type: Boolean, default: false },
  workspaceOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'start', 'stop', 'restart', 'edit', 'hover-enter', 'hover-leave', 'hover-cancel', 'branch-click', 'open-workspace', 'pull-git', 'push-git'])

const { addNotification } = useNotifications()

const cardRef = ref(null)
const expanded = ref(false)

const TYPE_ICONS = {
  service: 'fa-solid fa-server',
  agent: 'fa-solid fa-robot',
  desk: 'fa-solid fa-desktop',
  script: 'fa-solid fa-scroll',
}

const typeIcon = computed(() => TYPE_ICONS[props.node.type] || 'fa-solid fa-circle')

const agentTag = computed(() => {
  if (props.node.type !== 'agent') return null
  const cmd = String(props.node.command || '').toLowerCase()
  const name = String(props.node.name || '').toLowerCase()
  
  if (cmd.includes('gemini') || name.includes('gemini')) return { name: 'Gemini', icon: geminiIcon }
  if (cmd.includes('cursor') || name.includes('cursor')) return { name: 'Cursor', icon: cursorIcon }
  if (cmd.includes('claude') || name.includes('claude')) return { name: 'Claude', icon: claudeIcon }
  
  return null
})

function formatUptime(ms) {
  if (!ms) return '-'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
const uptime = computed(() => {
  if (props.node.status === 'running' && props.node.startedAt) {
    return formatUptime(Date.now() - props.node.startedAt)
  }
  return '-'
})

onUnmounted(() => {
})
</script>
