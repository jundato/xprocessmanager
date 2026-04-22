<script setup>
import { computed } from 'vue'

const props = defineProps({
  notification: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['close'])

const typeClass = computed(() => {
  return `notification-${props.notification.type || 'success'}`
})

const icon = computed(() => {
  switch (props.notification.type) {
    case 'error': return '❌'
    case 'warning': return '⚠️'
    case 'info': return 'ℹ️'
    default: return '✅'
  }
})
</script>

<template>
  <div class="notification-toast" :class="typeClass" @click="emit('close')">
    <span class="notification-icon">{{ icon }}</span>
    <span class="notification-message">{{ notification.message }}</span>
    <button class="notification-close">&times;</button>
  </div>
</template>

<style scoped>
.notification-toast {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: var(--surface2);
  border: 1px solid var(--border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  min-width: 250px;
  max-width: 400px;
  animation: slide-in 0.3s ease-out;
  transition: all 0.3s ease;
  pointer-events: auto;
}

.notification-toast:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}

.notification-icon {
  margin-right: 12px;
  font-size: 1.2rem;
}

.notification-message {
  flex: 1;
  font-size: 14px;
  color: var(--text);
}

.notification-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 20px;
  margin-left: 12px;
  cursor: pointer;
  padding: 0 4px;
}

.notification-close:hover {
  color: var(--text);
}

.notification-success {
  border-left: 4px solid var(--green);
}

.notification-error {
  border-left: 4px solid var(--red);
}

.notification-warning {
  border-left: 4px solid var(--yellow);
}

.notification-info {
  border-left: 4px solid var(--blue);
}

@keyframes slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
</style>
