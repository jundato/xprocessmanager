<template>
  <div v-if="show" class="modal-overlay" @mousedown.self="overlayMouseDown = true" @click.self="handleOverlayClick">
    <div class="modal modal-wide">
      <h2>Settings</h2>
      <div class="settings-tabs">
        <button
          class="settings-tab"
          :class="{ active: activeTab === 'general' }"
          @click="activeTab = 'general'"
        >General</button>
        <button
          class="settings-tab"
          :class="{ active: activeTab === 'advanced' }"
          @click="activeTab = 'advanced'"
        >Advanced</button>
        <button
          class="settings-tab"
          :class="{ active: activeTab === 'tools' }"
          @click="activeTab = 'tools'"
        >Tools</button>
        <button
          class="settings-tab"
          :class="{ active: activeTab === 'skills' }"
          @click="activeTab = 'skills'"
        >Skills</button>
      </div>
      <div class="modal-scroll">
        <!-- General Tab -->
        <div class="settings-tab-content" :class="{ active: activeTab === 'general' }">
          <!-- Import section -->
          <div class="settings-section">
            <div class="settings-section-title">Import nodes</div>
            <div class="env-note">
              Choose a JSON file in the same format as <code>processes.config.json</code>
              (an array of node definitions). Existing names are skipped.
            </div>
            <button type="button" class="btn-ghost" @click="triggerImport">Import…</button>
            <input
              ref="importFileRef"
              type="file"
              accept=".json"
              style="display: none"
              @change="onImportFile"
            />
          </div>

          <!-- Groups section -->
          <div class="settings-section">
            <div class="settings-section-title">Groups</div>
            <div class="env-note">
              Node groups, section order, and card border colors. Stored in
              <code>groups.config.json</code>. At least one group is required.
            </div>
            <div class="env-rows group-rows">
              <div
                v-for="(row, i) in groupRows"
                :key="i"
                class="env-row group-row"
                :class="{ 'drag-over-group': dragOverIndex === i }"
                draggable="true"
                @dragstart="onGroupDragStart(i, $event)"
                @dragover.prevent="onGroupDragOver(i)"
                @dragleave="onGroupDragLeave(i)"
                @drop.prevent="onGroupDrop(i)"
                @dragend="onGroupDragEnd"
              >
                <span class="group-drag-handle" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>
                <input
                  v-model="row.name"
                  type="text"
                  class="env-val group-name"
                  style="flex: 1"
                  placeholder="group name"
                />
                <input
                  v-model="row.color"
                  type="color"
                  class="group-color"
                  title="Border color"
                />
                <button type="button" class="btn-remove-row" @click="emit('remove-group', i)">&times;</button>
              </div>
            </div>
            <button type="button" class="btn-add-row" @click="emit('add-group')">+ Add group</button>
          </div>

          <!-- Environment section -->
          <div class="settings-section">
            <div class="settings-section-title">Environment variables</div>
            <div class="env-note">
              These variables are injected into all nodes at startup. Restart running nodes to pick up changes.
            </div>
            <div class="env-rows">
              <div v-for="(row, i) in envRows" :key="i" class="env-row">
                <input v-model="row.key" type="text" class="env-key" placeholder="KEY" />
                <input v-model="row.value" type="text" class="env-val" placeholder="value" />
                <button type="button" class="btn-remove-row" @click="emit('remove-env', i)">&times;</button>
              </div>
            </div>
            <button type="button" class="btn-add-row" @click="emit('add-env')">+ Add Variable</button>
          </div>
        </div>

        <!-- Advanced Tab -->
        <div class="settings-tab-content" :class="{ active: activeTab === 'advanced' }">
          <div class="settings-section" style="margin-top: 0; padding-top: 0; border-top: none">
            <div class="settings-section-title">Polling intervals</div>
            <div class="env-note">
              Control how frequently the UI fetches updates. Changes apply after saving
              (poll intervals apply immediately, port/maxLogLines require server restart).
            </div>
            <div class="setting-field">
              <label>Log poll interval (ms)</label>
              <input
                :value="logPollInterval"
                type="number" min="100" step="100"
                @input="emit('update:logPollInterval', parseInt($event.target.value) || 500)"
              />
            </div>
            <div class="setting-field">
              <label>Status poll interval (ms)</label>
              <input
                :value="statusPollInterval"
                type="number" min="500" step="500"
                @input="emit('update:statusPollInterval', parseInt($event.target.value) || 3000)"
              />
            </div>
            <div class="setting-field">
              <label>Popover poll interval (ms)</label>
              <input
                :value="popoverPollInterval"
                type="number" min="500" step="500"
                @input="emit('update:popoverPollInterval', parseInt($event.target.value) || 1500)"
              />
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-title">Server</div>
            <div class="env-note">Requires server restart to take effect.</div>
            <div class="setting-field">
              <label>Port</label>
              <input
                :value="port"
                type="number" min="1" max="65535"
                @input="emit('update:port', parseInt($event.target.value) || 1337)"
              />
            </div>
            <div class="setting-field">
              <label>Max log lines per node</label>
              <input
                :value="maxLogLines"
                type="number" min="50" step="50"
                @input="emit('update:maxLogLines', parseInt($event.target.value) || 500)"
              />
            </div>
            <div class="setting-field">
              <label>Terminal Width (Columns)</label>
              <input
                :value="terminalWidth"
                type="number" min="40" max="500" step="10"
                @input="emit('update:terminalWidth', parseInt($event.target.value) || 120)"
              />
              <div class="hint">Target column width for agent screens. Default: 120.</div>
            </div>
          </div>
        </div>

        <!-- Tools Tab -->
        <div class="settings-tab-content" :class="{ active: activeTab === 'tools' }">
          <div class="settings-section" style="margin-top: 0; padding-top: 0; border-top: none">
            <div class="settings-section-title">External Tools</div>
            <div class="env-note">
              Configure external scripts or executables that can be launched from the workspace.
              Stored in <code>tools.config.json</code>.
            </div>
            <div class="env-rows">
              <div v-for="(row, i) in toolRows" :key="i" class="env-row tool-row-layout">
                <div class="tool-main-info">
                  <div 
                    class="tool-builtin-toggle"
                    :class="{ active: row.isBuiltIn }"
                    @click="row.isBuiltIn = !row.isBuiltIn"
                    title="Toggle to display this tool on all cards by default (Starred)"
                  >
                    <i :class="row.isBuiltIn ? 'fa-solid fa-star' : 'fa-regular fa-star'"></i>
                  </div>
                  <div 
                    class="tool-builtin-toggle"
                    :class="{ active: row.requireConfirmation }"
                    @click="row.requireConfirmation = !row.requireConfirmation"
                    style="color: var(--orange, #fbbf24)"
                    title="Require confirmation before execution"
                  >
                    <i :class="row.requireConfirmation ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle-check'"></i>
                  </div>
                  <input v-model="row.label" type="text" class="env-key" placeholder="Tool Label" />
                  <div class="tool-path-group">
                    <input v-model="row.path" type="text" class="env-val" placeholder="File Path" />
                    <button type="button" class="btn-ghost" @click="emit('browse-tool', i)" title="Browse for file">
                      <i class="fa-solid fa-folder-open"></i>
                    </button>
                  </div>
                </div>

                <div class="tool-meta-actions">
                  <div 
                    class="tool-params-summary"
                    :title="row.params?.length ? 'Parameters: ' + row.params.map(p => p.label || 'Unnamed').join(', ') : 'No parameters defined'"
                  >
                    <i class="fa-solid fa-list-check"></i>
                    <span>{{ row.params?.length || 0 }} params</span>
                  </div>
                  <div class="tool-action-buttons">
                    <button type="button" class="btn-ghost tool-btn-settings" @click.stop="configToolIndex = i" title="Tool Settings">
                      <i class="fa-solid fa-gear"></i>
                    </button>
                    <button type="button" class="btn-remove-row" @click="emit('remove-tool', i)">&times;</button>
                  </div>
                </div>
              </div>
            </div>
            <button type="button" class="btn-add-row" @click="emit('add-tool')">+ Add Tool</button>
          </div>
        </div>

        <!-- Skills Tab -->
        <div class="settings-tab-content" :class="{ active: activeTab === 'skills' }">
          <div class="settings-section" style="margin-top: 0; padding-top: 0; border-top: none">
            <div class="settings-section-title">Skills</div>
            <div class="env-note">
              Reusable instruction packs stored as folders under <code>skills/&lt;name&gt;/SKILL.md</code>.
              When a chat starts, selected skills are copied into the node's working directory at
              <code>.nexus/skills/</code> (see <code>cli-unification.md</code>). Edit the body on disk
              or upload a prepared <code>SKILL.md</code> below.
            </div>
            <div class="env-rows">
              <div v-for="(row, i) in skillRows" :key="i" class="env-row">
                <input v-model="row.name" type="text" class="env-key" placeholder="skill-name" />
                <input v-model="row.description" type="text" class="env-val" placeholder="One-line description (used to decide relevance)" />
                <button type="button" class="btn-remove-row" @click="emit('remove-skill', i)">&times;</button>
              </div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn-add-row" style="margin: 0; flex: 0 0 auto" @click="emit('add-skill')">+ Add skill</button>
              <button type="button" class="btn-ghost" @click="triggerSkillUpload">
                <i class="fa-solid fa-upload"></i> Upload SKILL.md…
              </button>
              <input
                ref="skillUploadRef"
                type="file"
                accept=".md,text/markdown"
                style="display: none"
                @change="onSkillUploadFile"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-ghost" @click="emit('close')">Close</button>
        <button type="button" class="btn-start" @click="emit('save')">Save</button>
      </div>
    </div>

    <!-- Tool Parameter Settings (Global Overlay) -->
    <div v-if="configToolIndex !== null" class="tool-params-overlay" @click.stop>
      <div class="tool-params-content" @click.stop>
        <div class="tool-params-header">
          <span>Parameters for <strong>{{ toolRows[configToolIndex].label || 'Tool' }}</strong></span>
          <button type="button" class="btn-ghost" @click="configToolIndex = null">&times;</button>
        </div>
        <div class="tool-params-list">
          <div v-for="(p, pi) in toolRows[configToolIndex].params" :key="pi" class="tool-param-row">
            <input v-model="p.label" type="text" placeholder="Param Label" class="env-key" style="flex: 2" />
            <select v-model="p.type" class="env-val" style="flex: 1; height: 32px; padding: 0 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-main); font-size: 12px; border-radius: 4px;">
              <option value="text">Text</option>
              <option value="file">File</option>
              <option value="folder">Folder</option>
            </select>
            <button type="button" class="btn-remove-row" @click="toolRows[configToolIndex].params.splice(pi, 1)">&times;</button>
          </div>
          <div v-if="toolRows[configToolIndex].params.length === 0" style="font-size: 12px; color: var(--text-dim); text-align: center; padding: 12px;">
            No parameters defined.
          </div>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button type="button" class="btn-add-row" style="margin: 0; flex: 1" @click="toolRows[configToolIndex].params.push({ label: '', type: 'text' })">+ Add Parameter</button>
          <button type="button" class="btn-start" style="padding: 4px 12px; font-size: 12px;" @click="configToolIndex = null">Done</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  show: { type: Boolean, default: false },
  envRows: { type: Array, default: () => [] },
  groupRows: { type: Array, default: () => [] },
  toolRows: { type: Array, default: () => [] },
  skillRows: { type: Array, default: () => [] },
  logPollInterval: { type: Number, default: 500 },
  statusPollInterval: { type: Number, default: 3000 },
  popoverPollInterval: { type: Number, default: 1500 },
  port: { type: Number, default: 1337 },
  maxLogLines: { type: Number, default: 500 },
  terminalWidth: { type: Number, default: 120 },
})

const emit = defineEmits([
  'close', 'save',
  'add-env', 'remove-env',
  'add-group', 'remove-group',
  'add-tool', 'remove-tool', 'browse-tool',
  'add-skill', 'remove-skill', 'upload-skill',
  'reorder-groups',
  'import',
  'update:logPollInterval', 'update:statusPollInterval', 'update:popoverPollInterval',
  'update:port', 'update:maxLogLines', 'update:terminalWidth',
])

const overlayMouseDown = ref(false)
function handleOverlayClick() {
  if (overlayMouseDown.value) emit('close')
  overlayMouseDown.value = false
}

const activeTab = ref('general')
const configToolIndex = ref(null)
const importFileRef = ref(null)
const skillUploadRef = ref(null)

function triggerSkillUpload() {
  skillUploadRef.value?.click()
}

function onSkillUploadFile(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (file) emit('upload-skill', file)
}

// ── Group drag-and-drop ──────────────────
const dragIndex = ref(null)
const dragOverIndex = ref(null)

function onGroupDragStart(i, ev) {
  dragIndex.value = i
  ev.dataTransfer.effectAllowed = 'move'
}

function onGroupDragOver(i) {
  dragOverIndex.value = i
}

function onGroupDragLeave(i) {
  if (dragOverIndex.value === i) dragOverIndex.value = null
}

function onGroupDrop(i) {
  const from = dragIndex.value
  if (from === null || from === i) return
  emit('reorder-groups', { from, to: i })
  dragOverIndex.value = null
  dragIndex.value = null
}

function onGroupDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}

function triggerImport() {
  importFileRef.value?.click()
}

function onImportFile(e) {
  const file = e.target.files[0]
  e.target.value = ''
  if (file) {
    emit('import', file)
  }
}
</script>
