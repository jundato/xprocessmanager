import { ref } from 'vue'

const notifications = ref([])
const notificationHistory = ref(JSON.parse(localStorage.getItem('xpm-notification-history') || '[]'))
let nextId = 0

export function useNotifications() {
  function addNotification(message, type = 'success', duration = 3000) {
    const id = nextId++
    const timestamp = new Date().toISOString()
    
    const notification = {
      id,
      message,
      type, // 'success', 'error', 'info', 'warning'
      duration,
      timestamp
    }
    
    notifications.value.push(notification)

    // Add to history
    notificationHistory.value.unshift({
      message,
      type,
      timestamp
    })
    
    // Limit history to 100
    if (notificationHistory.value.length > 100) {
      notificationHistory.value = notificationHistory.value.slice(0, 100)
    }
    
    localStorage.setItem('xpm-notification-history', JSON.stringify(notificationHistory.value))

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

  function clearHistory() {
    notificationHistory.value = []
    localStorage.removeItem('xpm-notification-history')
  }

  return {
    notifications,
    notificationHistory,
    addNotification,
    removeNotification,
    clearHistory
  }
}
