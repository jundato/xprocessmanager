<script setup>
import { useNotifications } from '../composables/useNotifications'
import NotificationToast from './NotificationToast.vue'

const { notifications, removeNotification } = useNotifications()
</script>

<template>
  <div class="notification-container">
    <TransitionGroup name="list">
      <NotificationToast
        v-for="notification in notifications"
        :key="notification.id"
        :notification="notification"
        @close="removeNotification(notification.id)"
      />
    </TransitionGroup>
  </div>
</template>

<style scoped>
.notification-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  pointer-events: none;
}

.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.list-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.list-move {
  transition: transform 0.3s ease;
}
</style>
