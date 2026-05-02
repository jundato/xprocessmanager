<template>
  <div v-if="show" class="modal-overlay" @mousedown.self="overlayMouseDown = true" @click.self="handleOverlayClick">
    <div class="modal notification-history-modal">
      <div class="modal-header">
        <h2>Notification History</h2>
        <button class="btn-ghost" @click="clearHistory" title="Clear History">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
      <div class="modal-body">
        <div v-if="notificationHistory.length === 0" class="empty-state">
          No notifications yet.
        </div>
        <div v-else class="history-list">
          <div v-for="(entry, index) in notificationHistory" :key="index" class="history-item" :class="entry.type">
            <div class="history-content">
              <div class="history-message">{{ entry.message }}</div>
              <div class="history-time">{{ formatTime(entry.timestamp) }}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useNotifications } from '../composables/useNotifications'

defineProps({
  show: { type: Boolean, required: true }
})

const emit = defineEmits(['close'])

const { notificationHistory, clearHistory } = useNotifications()

const overlayMouseDown = ref(false)
function handleOverlayClick() {
  if (overlayMouseDown.value) emit('close')
  overlayMouseDown.value = false
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}
</script>

<style scoped>
.notification-history-modal {
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.modal-header h2 {
  font-size: 16px;
  color: var(--text);
  margin: 0;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  margin: 12px 0;
  padding-right: 4px;
}

.empty-state {
  text-align: center;
  padding: 40px 0;
  color: var(--text-dim);
  font-size: 14px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--bg-card);
  border-left: 4px solid var(--text-dim);
  font-size: 13px;
}

.history-item.success { border-left-color: var(--success); }
.history-item.error { border-left-color: var(--error); }
.history-item.info { border-left-color: var(--info); }
.history-item.warning { border-left-color: var(--warning); }

.history-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-message {
  color: var(--text);
  line-height: 1.4;
  word-break: break-word;
}

.history-time {
  font-size: 11px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}

.modal-actions {
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
}
</style>
