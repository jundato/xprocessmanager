import { ref } from 'vue'

const notifications = ref([])
let nextId = 0

export function useNotifications() {
  function addNotification(message, type = 'success', duration = 3000) {
    const id = nextId++
    const notification = {
      id,
      message,
      type, // 'success', 'error', 'info', 'warning'
      duration
    }
    notifications.value.push(notification)

    if (duration > 0) {
      setTimeout(() => {
        removeNotification(id)
      }, duration)
    }
    
    return id
  }

  function removeNotification(id) {
    const index = notifications.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notifications.value.splice(index, 1)
    }
  }

  return {
    notifications,
    addNotification,
    removeNotification
  }
}
