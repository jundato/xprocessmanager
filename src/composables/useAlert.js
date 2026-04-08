import { reactive } from 'vue'

const state = reactive({
  show: false,
  title: 'Alert',
  message: ''
})

export function useAlert() {
  function showAlert(title, message) {
    state.title = title || 'Alert'
    state.message = message || ''
    state.show = true
  }

  function hideAlert() {
    state.show = false
    state.message = ''
  }

  return {
    state,
    showAlert,
    hideAlert
  }
}
