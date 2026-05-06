import { ref, computed } from 'vue'
import { api } from './useApi'
import { useAlert } from './useAlert'
import cliInfo from '../../cli.info.json'

export function useSessions(node, emit) {
  const { showAlert } = useAlert()
  const showSessions = ref(false)
  const loadingSessions = ref(false)
  const sessions = ref([])

  const sessionCommand = computed(() => {
    const cmd = String(node.value?.command || '')
    const info = cliInfo.find(c => cmd.includes(c.cli))
    return info ? info.ls : 'agent ls'
  })

  async function fetchSessions() {
    loadingSessions.value = true
    try {
      const url = `/api/processes/${encodeURIComponent(node.value.guid)}/provider-sessions?cmd=${encodeURIComponent(sessionCommand.value)}`
      sessions.value = await api(url)
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
      showAlert('Error', 'Failed to fetch sessions.')
    } finally {
      loadingSessions.value = false
    }
  }

  async function toggleSessions() {
    const current = showSessions.value
    showSessions.value = !current
    if (showSessions.value) {
      await fetchSessions()
    }
  }

  async function resumeSession(sessionId) {
    try {
      const url = `/api/processes/${encodeURIComponent(node.value.guid)}/resume/${sessionId}`
      const result = await api(url, 'POST')
      if (result && result.staleSession) {
        try {
          const sessionsUrl = `/api/processes/${encodeURIComponent(node.value.guid)}/provider-sessions?cmd=${encodeURIComponent(sessionCommand.value)}`
          sessions.value = await api(sessionsUrl)
        } catch {}
        showAlert('Session unavailable', result.error)
        return
      }
      if (result && result.error) {
        showAlert('Error', `Failed to resume session: ${result.error}`)
        return
      }
      showSessions.value = false
      if (emit) emit('start', node.value.guid)
    } catch (err) {
      console.error('Failed to resume session:', err)
      showAlert('Error', `Failed to resume session: ${err.message}`)
    }
  }

  return {
    showSessions,
    loadingSessions,
    sessions,
    toggleSessions,
    fetchSessions,
    resumeSession
  }
}
