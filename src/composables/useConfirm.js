import { reactive } from 'vue'

const state = reactive({
  show: false,
  title: 'Confirm',
  message: '',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  danger: false,
})

let resolver = null

export function useConfirm() {
  function showConfirm(opts = {}) {
    state.title = opts.title || 'Confirm'
    state.message = opts.message || ''
    state.confirmText = opts.confirmText || 'Confirm'
    state.cancelText = opts.cancelText || 'Cancel'
    state.danger = !!opts.danger
    state.show = true
    return new Promise((resolve) => { resolver = resolve })
  }

  function resolveConfirm(value) {
    state.show = false
    if (resolver) {
      const r = resolver
      resolver = null
      r(value)
    }
  }

  return {
    state,
    showConfirm,
    resolveConfirm,
  }
}
