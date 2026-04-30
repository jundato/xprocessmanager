<template>
  <div v-if="node.branch" class="branch-tag-group" @click.stop>
    <span class="branch-tag" @click.stop="$emit('branch-click', node.guid)">{{ node.branch }}</span>
    <button
      v-if="gitRemoteStatus === 'behind'"
      class="btn-git-action btn-pull"
      @click.stop="pullGitChanges"
      title="Pull updates"
    >
      <i class="fa-solid fa-cloud-arrow-down"></i>
    </button>
    <button
      v-if="gitRemoteStatus === 'ahead'"
      class="btn-git-action btn-push"
      @click.stop="pushGitChanges"
      title="Push updates"
    >
      <i class="fa-solid fa-cloud-arrow-up"></i>
    </button>
    <button
      class="btn-git-action btn-refresh"
      :class="{ spinning: gitRemoteStatus === 'checking' }"
      @click.stop="checkGitStatus"
      title="Check for remote updates"
    >
      <i class="fa-solid fa-arrows-rotate"></i>
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { api } from '../composables/useApi.js'
import { useNotifications } from '../composables/useNotifications.js'

const props = defineProps({
  node: { type: Object, required: true },
})

const emit = defineEmits(['branch-click', 'pull-git', 'push-git'])

const { addNotification } = useNotifications()
const gitRemoteStatus = ref(null)

async function checkGitStatus() {
  gitRemoteStatus.value = 'checking'
  try {
    const res = await api(`/api/processes/${encodeURIComponent(props.node.guid)}/git/remote-status`, 'POST')
    gitRemoteStatus.value = res.status
  } catch (err) {
    console.error('Failed to check git status:', err)
    gitRemoteStatus.value = 'error'
    addNotification(`Failed to check git status for ${props.node.name}: ${err.message}`, 'error')
  }
}

async function pullGitChanges() {
  gitRemoteStatus.value = 'checking'
  emit('pull-git', props.node.guid, (success) => {
    if (success) {
      checkGitStatus()
    } else {
      gitRemoteStatus.value = 'behind'
    }
  })
}

async function pushGitChanges() {
  gitRemoteStatus.value = 'checking'
  emit('push-git', props.node.guid, (success) => {
    if (success) {
      checkGitStatus()
    } else {
      gitRemoteStatus.value = 'ahead'
    }
  })
}

// Optional: check status on mount?
// onMounted(checkGitStatus)
</script>
