<template>
  <div v-if="state.show" class="modal-overlay confirm-modal-overlay" @mousedown.self="overlayMouseDown = true" @click.self="handleOverlayClick">
    <div class="modal confirm-modal">
      <div class="modal-header">
        <h2>{{ state.title }}</h2>
      </div>
      <div class="modal-body">
        <p>{{ state.message }}</p>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" @click="resolveConfirm(false)">{{ state.cancelText }}</button>
        <button :class="state.danger ? 'btn-stop' : 'btn-start'" @click="resolveConfirm(true)">{{ state.confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useConfirm } from '../composables/useConfirm.js'

const { state, resolveConfirm } = useConfirm()

const overlayMouseDown = ref(false)
function handleOverlayClick() {
  if (overlayMouseDown.value) resolveConfirm(false)
  overlayMouseDown.value = false
}
</script>

<style scoped>
.confirm-modal-overlay {
  z-index: 2200;
}
.confirm-modal {
  width: 420px;
  max-width: 90vw;
}
.modal-header h2 {
  margin-bottom: 12px;
  font-size: 16px;
  color: var(--text);
}
.modal-body p {
  font-size: 14px;
  color: var(--text-dim);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
