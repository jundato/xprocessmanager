import { ref } from 'vue'
import { api } from './useApi'

export function useChats(parentGuidRef) {
  const chats = ref([])
  const loading = ref(false)
  let pollTimer = null

  function getParent() {
    const v = parentGuidRef && typeof parentGuidRef === 'object' && 'value' in parentGuidRef
      ? parentGuidRef.value
      : parentGuidRef
    return v
  }

  async function fetchChats({ silent = false } = {}) {
    const parent = getParent()
    if (!parent) { chats.value = []; return }
    if (!silent) loading.value = true
    try {
      const res = await api(`/api/processes/${encodeURIComponent(parent)}/chats`)
      chats.value = Array.isArray(res) ? res : []
    } catch (err) {
      console.error('Failed to fetch chats:', err)
      if (!silent) chats.value = []
    } finally {
      if (!silent) loading.value = false
    }
  }

  function startPolling(intervalMs = 1500) {
    stopPolling()
    pollTimer = setInterval(() => fetchChats({ silent: true }), intervalMs)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function spawnChat(input) {
    const parent = getParent()
    if (!parent) throw new Error('No parent guid')
    const body = typeof input === 'string' ? { instruction: input } : { ...input }
    const res = await api(
      `/api/processes/${encodeURIComponent(parent)}/chats`,
      'POST',
      body
    )
    if (res && res.error) throw new Error(res.error)
    chats.value.push({
      chatId: res.chatId,
      instruction: res.instruction,
      title: res.title || null,
      resumeId: res.resumeId || null,
      startedAt: res.startedAt,
      status: res.status,
      needsInput: false,
    })
    return res
  }

  async function killChat(chatId) {
    const parent = getParent()
    if (!parent) return
    try {
      await api(
        `/api/processes/${encodeURIComponent(parent)}/chats/${encodeURIComponent(chatId)}`,
        'DELETE'
      )
    } catch (err) {
      console.error('Failed to kill chat:', err)
    }
    chats.value = chats.value.filter((c) => c.chatId !== chatId)
  }

  return { chats, loading, fetchChats, spawnChat, killChat, startPolling, stopPolling }
}
