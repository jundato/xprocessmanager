<template>
  <div
    ref="cardRef"
    class="card"
    :class="{ selected: isSelected, expanded, stopped: node.status !== 'running' }"
    :style="{ borderColor, '--card-color': borderColor }"
    @click="$emit('select', node.guid)"
    @mouseenter="$emit('hover-enter', node.guid, $event.currentTarget, expanded, node.command)"
    @mouseleave="!expanded && $emit('hover-leave', node.guid)"
  >
    <div class="card-header">
      <div class="card-header-left">
        <div class="card-name">
          <i :class="[typeIcon, 'node-type-icon', node.status]" :title="node.type"></i>
          {{ node.name }}
          <i v-if="node.type === 'script' && node.status === 'running'" class="fa-solid fa-spinner script-running-spinner" style="margin-left: 8px;" title="Running..."></i>
          <i v-if="node.needsInput" class="fa-solid fa-keyboard fa-fade" style="margin-left: 8px; color: #fbbf24;" title="Waiting for input..."></i>
        </div>

        <GitBranchTag
          :node="node"
          @branch-click="$emit('branch-click', $event)"
          @pull-git="(...args) => $emit('pull-git', ...args)"
          @push-git="(...args) => $emit('push-git', ...args)"
        />
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
    <div class="card-meta">
      <div class="card-meta-info">
        <span class="pid-badge" title="PID"><i class="fa-solid fa-hashtag mr-1"></i>{{ node.pid || '-' }}</span>
        <span title="Uptime"><i class="fa-regular fa-clock mr-1"></i>{{ uptime }}</span>
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

function formatUptime(ms) {
...
const uptime = computed(() => {
  if (props.node.status === 'running' && props.node.startedAt) {
    return formatUptime(Date.now() - props.node.startedAt)
  }
  return '-'
})

onUnmounted(() => {
})
</script>
