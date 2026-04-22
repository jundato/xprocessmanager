<template>
  <div class="task-overlay">
    <TransitionGroup name="task-list">
      <div v-for="task in activeTasks" :key="task.id" class="task-item" :class="task.status">
        <div class="task-content">
          <div class="task-header">
            <div class="task-icon-container">
              <svg v-if="task.status === 'running'" class="progress-ring" viewBox="0 0 24 24">
                <circle class="progress-ring-track" cx="12" cy="12" r="10" fill="none" stroke-width="2" />
                <circle class="progress-ring-fill" cx="12" cy="12" r="10" fill="none" stroke-width="2" />
              </svg>
              <i v-else-if="task.status === 'success'" class="fa-solid fa-check-circle success-icon"></i>
              <i v-else-if="task.status === 'failed'" class="fa-solid fa-circle-exclamation error-icon"></i>
            </div>
            <div class="task-info">
              <div class="task-label">{{ task.label }}</div>
              <div class="task-node">{{ task.nodeName }}</div>
            </div>
            <button class="task-close" @click="removeTask(task.id)" title="Close">&times;</button>
          </div>
          <div v-if="task.output" class="task-output-container">
            <div class="task-output-header">OUTPUT</div>
            <pre class="task-output">{{ task.output }}</pre>
          </div>
        </div>
        <div v-if="task.status === 'running'" class="task-glow"></div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useTasks } from '../composables/useTasks.js'

const { activeTasks, removeTask } = useTasks()
</script>

<style scoped>
.task-overlay {
  position: fixed;
  bottom: 24px;
  left: 24px;
  z-index: 1000;
  display: flex;
  flex-direction: column-reverse;
  gap: 12px;
  pointer-events: none;
  width: 340px;
}

.task-item {
  background: #0d0f14;
  border: 1px solid #2e3144;
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
  pointer-events: auto;
  position: relative;
  overflow: hidden;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.task-content {
  padding: 14px;
  position: relative;
  z-index: 2;
}

.task-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.task-icon-container {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.progress-ring {
  width: 22px;
  height: 22px;
  transform: rotate(-90deg);
}

.progress-ring-track {
  stroke: rgba(255, 255, 255, 0.05);
}

.progress-ring-fill {
  stroke: var(--blue);
  stroke-dasharray: 62.8;
  stroke-dashoffset: 40;
  animation: ring-rotate 1.5s ease-in-out infinite;
  stroke-linecap: round;
}

@keyframes ring-rotate {
  0% { stroke-dashoffset: 60; transform: rotate(0deg); }
  50% { stroke-dashoffset: 20; transform: rotate(180deg); }
  100% { stroke-dashoffset: 60; transform: rotate(360deg); }
}

.success-icon { color: var(--green); font-size: 20px; }
.error-icon { color: var(--red); font-size: 20px; }

.task-info {
  flex: 1;
  min-width: 0;
}

.task-label {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.3px;
}

.task-node {
  font-size: 10px;
  color: var(--text-dim);
  font-family: 'SF Mono', 'Fira Code', monospace;
  margin-top: 1px;
}

.task-close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color 0.2s;
}

.task-close:hover {
  color: #fff;
}

.task-output-container {
  margin-top: 12px;
  background: #050608;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.task-output-header {
  font-size: 9px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.3);
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.02);
  letter-spacing: 1px;
}

.task-output {
  padding: 8px;
  font-size: 10px;
  font-family: 'SF Mono', 'Fira Code', 'Menlo', monospace;
  color: #a5b4fc;
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
  margin: 0;
}

.task-item.failed .task-output {
  color: #fda4af;
}

.task-glow {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--blue), transparent);
  animation: glow-move 2s linear infinite;
}

@keyframes glow-move {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}

/* Transitions */
.task-list-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.9);
}
.task-list-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}
</style>
