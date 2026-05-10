<template>
  <div v-if="show" class="modal-overlay chat-modal-overlay" @mousedown.self="overlayDown = true" @click.self="onOverlayClick">
    <div class="modal chat-modal" @keydown.esc="$emit('cancel')">
      <div class="modal-header">
        <h2>New chat</h2>
      </div>
      <div class="modal-body">
        <label class="chat-label">Instruction</label>
        <textarea
          ref="textareaRef"
          v-model="instruction"
          class="chat-instruction"
          rows="6"
          placeholder="What should the agent do?"
          @keydown.enter.exact.prevent="onOk"
        ></textarea>
        <div class="chat-hint">Enter to send · Shift+Enter for newline · Esc to cancel</div>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" @click="$emit('cancel')">Cancel</button>
        <button class="btn-start" :disabled="!instruction.trim() || submitting" @click="onOk">
          {{ submitting ? 'Starting…' : 'OK' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
})
const emit = defineEmits(['ok', 'cancel'])

const instruction = ref('')
const textareaRef = ref(null)
const overlayDown = ref(false)

watch(() => props.show, (v) => {
  if (v) {
    instruction.value = ''
    nextTick(() => textareaRef.value?.focus())
  }
})

function onOk() {
  const text = instruction.value.trim()
  if (!text || props.submitting) return
  emit('ok', text)
}

function onOverlayClick() {
  if (overlayDown.value) emit('cancel')
  overlayDown.value = false
}
</script>

<style scoped>
.chat-modal-overlay {
  z-index: 100;
}
.chat-modal {
  width: 520px;
  max-width: 90vw;
}
.modal-header h2 {
  margin-bottom: 12px;
  font-size: 16px;
  color: var(--text);
}
.chat-label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.chat-instruction {
  width: 100%;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  resize: vertical;
  min-height: 96px;
  outline: none;
}
.chat-instruction:focus {
  border-color: var(--blue, #3b82f6);
}
.chat-hint {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 6px;
}
</style>
