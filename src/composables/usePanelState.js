const KEY_PREFIX = 'xpm-panel-state:'

export function getPanelState(nodeGuid) {
  if (!nodeGuid) return null
  try {
    const raw = localStorage.getItem(KEY_PREFIX + nodeGuid)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setPanelState(nodeGuid, state) {
  if (!nodeGuid) return
  try {
    if (!state) localStorage.removeItem(KEY_PREFIX + nodeGuid)
    else localStorage.setItem(KEY_PREFIX + nodeGuid, JSON.stringify(state))
  } catch {}
}

export function patchPanelState(nodeGuid, partial) {
  const cur = getPanelState(nodeGuid) || {}
  setPanelState(nodeGuid, { ...cur, ...partial })
}
