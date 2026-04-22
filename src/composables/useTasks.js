import { ref, reactive } from 'vue'
import { api } from './useApi.js'
import { useNotifications } from './useNotifications.js'

const activeTasks = ref([])

export function useTasks() {
  const { addNotification } = useNotifications()

  async function executeTool(nodeName, tool, param = '') {
    const taskId = Math.random().toString(36).substring(2, 9)
    const task = reactive({
      id: taskId,
      nodeName,
      label: tool.label,
      status: 'running',
      output: '',
      startedAt: Date.now()
    })
    
    activeTasks.value.push(task)

    try {
      const result = await api(`/api/processes/${encodeURIComponent(nodeName)}/tools/execute`, 'POST', {
        toolLabel: tool.label,
        param
      })

      if (result.error) {
        task.status = 'failed'
        task.output = result.error
        addNotification(`Tool "${tool.label}" failed on ${nodeName}: ${result.error}`, 'error')
      } else {
        task.status = 'success'
        task.output = result.output || 'Completed successfully'
        addNotification(`Tool "${tool.label}" completed on ${nodeName}`)
      }
    } catch (err) {
      task.status = 'failed'
      task.output = err.message
      addNotification(`Tool "${tool.label}" error on ${nodeName}: ${err.message}`, 'error')
    }

    // Auto-close logic
    const duration = task.status === 'success' ? 8000 : 20000
    setTimeout(() => {
      removeTask(taskId)
    }, duration)
  }

  function removeTask(id) {
    const idx = activeTasks.value.findIndex(t => t.id === id)
    if (idx !== -1) {
      activeTasks.value.splice(idx, 1)
    }
  }

  return {
    activeTasks,
    executeTool,
    removeTask
  }
}
