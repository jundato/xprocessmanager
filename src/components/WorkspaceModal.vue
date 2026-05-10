<template>
  <div
    v-if="show"
    :class="(docked && !noHeader) ? 'workspace-docked-wrapper' : (docked && noHeader) ? 'workspace-embedded-wrapper' : ['modal-overlay', 'workspace-modal-overlay', { 'align-top': isAgent }]"
    :style="(docked && !noHeader) ? { width: dockedWidth + 'px', height: dockedHeight + 'px' } : (docked && noHeader) ? { width: '100%', height: '100%' } : null"
    @mousedown.self="!docked && (overlayMouseDown = true)"
    @click.self="!docked && handleOverlayClick()"
  >
    <div class="modal workspace-modal"
         :class="{ 'workspace-modal-editor': tabs.length > 0, 'workspace-modal-agent': isAgent && !docked, 'workspace-modal-docked': docked }"
         :style="docked ? { width: '100%', height: '100%', maxWidth: 'none', borderRadius: 0, border: '1px solid #3b82f6' } : (isAgent ? { height: `calc(100vh - 70px - ${logPanelHeight}px)` } : {})">
      <div v-if="!noHeader" class="workspace-header">
        <h2>
          <i :class="isAgent ? 'fa-solid fa-laptop-code' : 'fa-solid fa-folder-open'" style="margin-right: 8px; color: var(--yellow)"></i>
          {{ nodeName }}
        </h2>
        <div style="display: flex; gap: 6px; margin-left: auto">
          <button class="btn-ghost btn-icon" @click="handleClose" title="Close Workspace">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <div class="workspace-body" :class="{ 'has-tabs': tabs.length > 0 }">
        <!-- Main content pane (Browser) -->
        <div class="workspace-main">
          <div class="workspace-search-bar">
            <i class="fa-solid fa-magnifying-glass workspace-search-icon"></i>
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              class="workspace-search-input"
              placeholder="Search files and content..."
              @input="onSearchInput"
              @keydown.esc="clearSearch"
            />
            <button v-if="searchQuery" class="workspace-search-clear" @click="clearSearch">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <!-- Search Results -->
          <template v-if="searchActive">
            <div class="workspace-file-list">
              <div class="workspace-file-list-header">
                <input
                  type="checkbox"
                  class="workspace-file-checkbox"
                  :checked="isAllInViewSelected"
                  @change="toggleSelectAllInView"
                />
                <span>File</span>
                <span v-if="selectedFiles.length" style="margin-left: auto; text-transform: none; color: var(--blue)">
                  {{ selectedFiles.length }} selected
                </span>
                <button
                  v-if="selectedFiles.length"
                  class="btn-ghost btn-icon workspace-bulk-delete"
                  :disabled="deleting"
                  @click="deleteSelected"
                  title="Delete selected"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
              <div v-if="searchLoading" class="workspace-empty">Searching...</div>
              <div v-if="!searchLoading && !searchResults.length && searchQuery" class="workspace-empty">No results found</div>
              <div
                v-for="(result, i) in searchResults"
                :key="i"
                class="workspace-file-item clickable"
                @click="openFileFromSearch(result)"
              >
                <input
                  type="checkbox"
                  class="workspace-file-checkbox"
                  :checked="selectedFiles.includes(result.path)"
                  @click.stop="toggleFileSelection(result.path)"
                />
                <i :class="fileIconByName(result.path)" style="width: 16px"></i>
                <div class="search-result-info">
                  <span class="file-name">{{ result.path }}</span>
                  <span v-if="result.type === 'content'" class="search-result-line">
                    L{{ result.line }}: {{ result.text }}
                  </span>
                </div>
                <span class="search-result-badge" :class="result.type === 'file' ? 'badge-file' : 'badge-content'">
                  {{ result.type === 'file' ? 'name' : 'content' }}
                </span>
                <button
                  class="btn-ghost btn-icon workspace-row-delete"
                  :disabled="deleting"
                  @click.stop="deleteEntry(result.path, false)"
                  title="Delete file"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </template>

          <!-- Normal Directory Listing -->
          <template v-else>
            <div class="workspace-breadcrumb">
              <span class="breadcrumb-segment" @click="navigateTo('')">root</span>
              <template v-for="(seg, i) in pathSegments" :key="i">
                <span class="breadcrumb-sep">/</span>
                <span class="breadcrumb-segment" @click="navigateTo(pathSegments.slice(0, i + 1).join('/'))">{{ seg }}</span>
              </template>
              <button class="btn-ghost btn-icon" style="margin-left: auto; font-size: 11px;" @click="fetchFiles(currentPath)" title="Refresh files">
                <i class="fa-solid fa-rotate" :class="{ 'fa-spin': listLoading }"></i>
              </button>
            </div>
            <div class="workspace-file-list">
              <div class="workspace-file-list-header">
                <input
                  type="checkbox"
                  class="workspace-file-checkbox"
                  :checked="isAllInViewSelected"
                  @change="toggleSelectAllInView"
                />
                <span>Name</span>
                <span v-if="selectedFiles.length" style="margin-left: auto; text-transform: none; color: var(--blue)">
                  {{ selectedFiles.length }} selected
                </span>
                <button
                  v-if="selectedFiles.length"
                  class="btn-ghost btn-icon workspace-bulk-delete"
                  :disabled="deleting"
                  @click="deleteSelected"
                  title="Delete selected"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
              <div v-if="currentPath" class="workspace-file-item directory" @click="navigateUp">
                <div style="width: 14px; flex-shrink: 0"></div>
                <i class="fa-solid fa-arrow-up" style="width: 16px; color: var(--text-dim)"></i>
                <span class="file-name">..</span>
              </div>
              <div
                v-for="file in files"
                :key="file.name"
                class="workspace-file-item"
                :class="{ directory: file.isDirectory, clickable: !file.isDirectory }"
                @click="handleFileClick(file)"
              >
                <input
                  type="checkbox"
                  class="workspace-file-checkbox"
                  :checked="selectedFiles.includes(currentPath ? `${currentPath}/${file.name}` : file.name)"
                  @click.stop="toggleFileSelection(currentPath ? `${currentPath}/${file.name}` : file.name)"
                />
                <i :class="fileIcon(file)" style="width: 16px"></i>
                <span class="file-name">{{ file.name }}</span>
                <span v-if="!file.isDirectory && file.size != null" class="file-size">{{ formatSize(file.size) }}</span>
                <button
                  class="btn-ghost btn-icon workspace-row-delete"
                  :disabled="deleting"
                  @click.stop="deleteEntry(currentPath ? `${currentPath}/${file.name}` : file.name, file.isDirectory)"
                  :title="file.isDirectory ? 'Delete folder' : 'Delete file'"
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
              <div v-if="!listLoading && !files.length" class="workspace-empty">Empty directory</div>
              <div v-if="listLoading" class="workspace-empty">Loading...</div>
              <div v-if="listError" class="workspace-empty" style="color: var(--red)">{{ listError }}</div>
            </div>
          </template>
        </div>

        <!-- Resizer -->
        <div v-if="tabs.length > 0" class="workspace-resizer" @mousedown="startResizing"></div>

        <!-- Tabbed side panel -->
        <div class="workspace-tabs-panel" :style="{ width: terminalWidth + 'px' }">
          <div class="workspace-tabs-header">
            <div
              v-for="tab in tabs"
              :key="tab.id"
              class="workspace-tab"
              :class="{ active: activeTabId === tab.id }"
              @click="activeTabId = tab.id"
            >
              <i :class="fileIconByName(tab.name)" style="margin-right: 6px"></i>
              <span class="tab-name">{{ tab.name }}</span>
              <button class="tab-close" @click.stop="closeTab(tab.id)">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>

          <div class="workspace-tab-content">
            <!-- File Tab -->
            <div v-show="activeTab?.type === 'file'" class="workspace-file-tab">
              <div class="workspace-editor-bar">
                <span class="workspace-editor-filename">
                  <i :class="fileIconByName(activeTab?.path || '')" style="margin-right: 6px"></i>
                  {{ activeTab?.path }}
                </span>
                <div style="display: flex; gap: 6px; align-items: center">
                  <button class="btn-ghost btn-icon" style="font-size: 11px;" @click="refreshActiveFile" title="Refresh file from disk">
                    <i class="fa-solid fa-rotate" :class="{ 'fa-spin': fileLoading }"></i>
                  </button>
                  <button v-if="isMarkdown" class="btn-ghost" style="padding: 3px 10px; font-size: 11px" @click="toggleMarkdownEdit">

                    <i :class="markdownEditMode ? 'fa-solid fa-eye' : 'fa-solid fa-pen'" style="margin-right: 4px"></i>
                    {{ markdownEditMode ? 'Preview' : 'Edit Source' }}
                  </button>
                  <span v-if="dirty" class="workspace-dirty-badge">Modified</span>
                  <button v-if="!isMarkdown || markdownEditMode" class="btn-start" :disabled="!dirty || saving" @click="saveFile" style="padding: 4px 12px; font-size: 12px">
                    {{ saving ? 'Saving...' : 'Save' }}
                  </button>
                </div>
              </div>

              <div v-if="fileLoading" class="workspace-empty">Loading file...</div>
              <div v-if="fileError" class="workspace-empty" style="color: var(--red)">{{ fileError }}</div>

              <!-- Markdown rendered preview -->
              <div v-if="isMarkdown && !markdownEditMode" ref="mdPreviewRef" class="workspace-md-preview" v-html="renderedMarkdown"></div>

              <!-- Monaco editor container -->
              <div v-show="!isMarkdown || markdownEditMode" ref="editorContainerRef" class="workspace-editor-container"></div>
            </div>

            <!-- Image Tab -->
            <div v-show="activeTab?.type === 'image'" class="workspace-image-tab">
              <div class="workspace-editor-bar">
                <span class="workspace-editor-filename">
                  <i :class="fileIconByName(activeTab?.path || '')" style="margin-right: 6px"></i>
                  {{ activeTab?.path }}
                </span>
              </div>
              <div class="workspace-image-viewer">
                <img v-if="activeTab?.type === 'image'" :src="activeTab.src" :alt="activeTab.name" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Mermaid Editor UI -->
    <MermaidEditor
      v-if="mermaidEditorOpen"
      :initialCode="mermaidEditorCode"
      @save="onMermaidSave"
      @cancel="closeMermaidEditor"
    />
  </div>
</template>

<script setup>
import { ref, watch, computed, nextTick, onMounted, onUnmounted, shallowRef, markRaw } from 'vue'
import { api } from '../composables/useApi.js'
import { useConfirm } from '../composables/useConfirm.js'
import MermaidEditor from './MermaidEditor.vue'

const { showConfirm } = useConfirm()

const props = defineProps({
  show: { type: Boolean, default: false },
  nodeName: { type: String, default: null },
  nodeGuid: { type: String, default: null },
  nodeStatus: { type: String, default: null },
  isAgent: { type: Boolean, default: false },
  logPanelHeight: { type: Number, default: 0 },
  initialFile: { type: String, default: null },
  initialLine: { type: Number, default: null },
  initialColumn: { type: Number, default: null },
  initialScrollTop: { type: Number, default: null },
  docked: { type: Boolean, default: false },
  dockedWidth: { type: Number, default: 480 },
  dockedHeight: { type: Number, default: 300 },
  noHeader: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'start-node'])

const overlayMouseDown = ref(false)
function handleOverlayClick() {
  if (overlayMouseDown.value) {
    handleClose()
  }
  overlayMouseDown.value = false
}

function handleClose() {
  emit('close')
}

// ── Tabs State ──────────────────────────────
const tabs = ref([]) // { id, type: 'file'|'terminal', name, path, model, state }
const activeTabId = ref(null)

const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value))

function addTab(tab) {
  const existing = tabs.value.find((t) => t.id === tab.id)
  if (!existing) {
    tabs.value.push(tab)
  }
  activeTabId.value = tab.id
}

async function closeTab(id) {
  const idx = tabs.value.findIndex((t) => t.id === id)
  if (idx === -1) return

  const tab = tabs.value[idx]
  if (tab.type === 'file' && tab.model) {
    tab.model.dispose()
  }

  tabs.value.splice(idx, 1)

  if (activeTabId.value === id) {
    if (tabs.value.length > 0) {
      activeTabId.value = tabs.value[Math.max(0, idx - 1)].id
    } else {
      activeTabId.value = null
    }
  }
}

const searchInputRef = ref(null)
const searchQuery = ref('')
const searchResults = ref([])
const searchLoading = ref(false)
const searchActive = computed(() => searchQuery.value.length > 0)
let searchDebounce = null

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    return
  }
  searchDebounce = setTimeout(() => runSearch(), 300)
}

async function runSearch() {
  const q = searchQuery.value.trim()
  if (!q || !props.nodeGuid) return
  searchLoading.value = true
  const res = await api(`/api/processes/${encodeURIComponent(props.nodeGuid)}/search?q=${encodeURIComponent(q)}`)
  searchLoading.value = false
  if (res.error) return
  searchResults.value = res.results || []
}

function clearSearch() {
  searchQuery.value = ''
  searchResults.value = []
}

function openFileFromSearch(result) {
  openFileView(result.path, result.type === 'content' ? result.line : null)
}

// ── File Browser State ──────────────────────
const files = ref([])
const currentPath = ref('')
const listLoading = ref(false)
const listError = ref(null)
const selectedFiles = ref([])

const pathSegments = computed(() => {
  if (!currentPath.value) return []
  return currentPath.value.split('/').filter(Boolean)
})

const isAllInViewSelected = computed(() => {
  if (searchActive.value) {
    if (searchResults.value.length === 0) return false
    return searchResults.value.every((r) => selectedFiles.value.includes(r.path))
  }
  if (files.value.length === 0) return false
  return files.value.every((f) => {
    const fullPath = currentPath.value ? `${currentPath.value}/${f.name}` : f.name
    return selectedFiles.value.includes(fullPath)
  })
})

function toggleSelectAllInView() {
  if (isAllInViewSelected.value) {
    if (searchActive.value) {
      searchResults.value.forEach((r) => {
        const idx = selectedFiles.value.indexOf(r.path)
        if (idx !== -1) selectedFiles.value.splice(idx, 1)
      })
    } else {
      files.value.forEach((f) => {
        const fullPath = currentPath.value ? `${currentPath.value}/${f.name}` : f.name
        const idx = selectedFiles.value.indexOf(fullPath)
        if (idx !== -1) selectedFiles.value.splice(idx, 1)
      })
    }
  } else {
    if (searchActive.value) {
      searchResults.value.forEach((r) => {
        if (!selectedFiles.value.includes(r.path)) selectedFiles.value.push(r.path)
      })
    } else {
      files.value.forEach((f) => {
        const fullPath = currentPath.value ? `${currentPath.value}/${f.name}` : f.name
        if (!selectedFiles.value.includes(fullPath)) selectedFiles.value.push(fullPath)
      })
    }
  }
}

function toggleFileSelection(path) {
  const idx = selectedFiles.value.indexOf(path)
  if (idx === -1) {
    selectedFiles.value.push(path)
  } else {
    selectedFiles.value.splice(idx, 1)
  }
}

async function fetchFiles(subPath) {
  if (!props.nodeGuid) return
  listLoading.value = true
  listError.value = null
  files.value = []
  const query = subPath ? `?path=${encodeURIComponent(subPath)}` : ''
  const res = await api(`/api/processes/${encodeURIComponent(props.nodeGuid)}/files${query}`)
  listLoading.value = false
  if (res.error) { listError.value = res.error; return }
  files.value = res.files || []
  currentPath.value = subPath || ''
}

function navigateTo(subPath) { fetchFiles(subPath) }

function navigateUp() {
  const segments = [...pathSegments.value]
  segments.pop()
  fetchFiles(segments.join('/'))
}

function handleFileClick(file) {
  if (file.isDirectory) {
    navigateTo(currentPath.value ? currentPath.value + '/' + file.name : file.name)
  } else {
    openFileView(currentPath.value ? currentPath.value + '/' + file.name : file.name)
  }
}

// ── Deletion ────────────────────────────────
const deleting = ref(false)

function closeTabsForPath(p) {
  const prefix = p.endsWith('/') ? p : p + '/'
  const toClose = tabs.value.filter((t) => t.path === p || (t.path && t.path.startsWith(prefix)))
  toClose.forEach((t) => closeTab(t.id))
}

async function performDelete(paths) {
  if (!props.nodeGuid || !paths.length) return
  deleting.value = true
  const res = await api(
    `/api/processes/${encodeURIComponent(props.nodeGuid)}/file`,
    'DELETE',
    { paths }
  )
  deleting.value = false
  if (res.error && (!res.deleted || !res.deleted.length)) {
    listError.value = res.error
    return
  }
  const deleted = res.deleted || paths
  deleted.forEach(closeTabsForPath)
  selectedFiles.value = selectedFiles.value.filter((p) => !deleted.includes(p))
  if (searchActive.value) {
    searchResults.value = searchResults.value.filter((r) => !deleted.includes(r.path))
  }
  await fetchFiles(currentPath.value)
}

async function deleteEntry(path, isDirectory) {
  const ok = await showConfirm({
    title: isDirectory ? 'Delete folder' : 'Delete file',
    message: isDirectory
      ? `Delete folder "${path}" and all its contents?\n\nThis cannot be undone.`
      : `Delete file "${path}"?\n\nThis cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    danger: true,
  })
  if (!ok) return
  await performDelete([path])
}

async function deleteSelected() {
  const paths = [...selectedFiles.value]
  if (!paths.length) return
  const ok = await showConfirm({
    title: 'Delete selected',
    message: `Delete ${paths.length} item${paths.length === 1 ? '' : 's'}?\n\nThis cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    danger: true,
  })
  if (!ok) return
  await performDelete(paths)
}

// ── Editor / Preview State ──────────────────
const fileLoading = ref(false)
const fileError = ref(null)
const dirty = ref(false)
const saving = ref(false)
const editorContainerRef = ref(null)
const mdPreviewRef = ref(null)
const markdownEditMode = ref(false)
const renderedMarkdown = ref('')

let editorInstance = null
let monacoModule = shallowRef(null)
let markedModule = null
let mermaidModule = null
let mermaidId = 0

const isMarkdown = computed(() => {
  if (activeTab.value?.type !== 'file') return false
  return activeTab.value.path.toLowerCase().endsWith('.md')
})

function isImageFile(filePath) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(filePath || '')
}

let mermaidBlockIndexCounter = 0

async function loadMarked() {
  if (markedModule) return markedModule
  markedModule = await import('marked')
  const { marked } = markedModule

  const renderer = new marked.Renderer()
  const origCode = renderer.code.bind(renderer)
  renderer.code = function ({ text, lang }) {
    if (lang === 'mermaid') {
      const id = `mermaid-${++mermaidId}`
      const index = mermaidBlockIndexCounter++
      return `<div class="mermaid-placeholder clickable" style="cursor: pointer;" title="Click to edit diagram" data-mermaid-id="${id}" data-mermaid-index="${index}">${escapeHtml(text)}</div>`
    }
    return origCode({ text, lang })
  }
  marked.setOptions({ renderer })
  return markedModule
}

async function loadMermaid() {
  if (mermaidModule) return mermaidModule
  const mod = await import('mermaid')
  mermaidModule = mod.default
  mermaidModule.initialize({ startOnLoad: false, theme: 'dark' })
  return mermaidModule
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderMarkdown(content) {
  if (!markedModule) return ''
  const { marked } = markedModule
  mermaidBlockIndexCounter = 0
  return marked.parse(content)
}

const mermaidEditorOpen = ref(false)
const mermaidEditorCode = ref('')
const mermaidEditorIndex = ref(null)

async function openMermaidEditor(index, code) {
  mermaidEditorIndex.value = index
  mermaidEditorCode.value = code
  mermaidEditorOpen.value = true
}

function closeMermaidEditor() {
  mermaidEditorOpen.value = false
}

async function onMermaidSave(newCode) {
  if (mermaidEditorIndex.value === null || !activeTab.value?.model) return

  const currentContent = activeTab.value.model.getValue()
  const lines = currentContent.split('\n')
  let currentMermaidIndex = -1
  let inMermaid = false
  let startIndex = -1
  let endIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('```mermaid')) {
      currentMermaidIndex++
      if (currentMermaidIndex === parseInt(mermaidEditorIndex.value, 10)) {
        inMermaid = true
        startIndex = i
      }
    } else if (inMermaid && line.startsWith('```')) {
      endIndex = i
      break
    }
  }

  if (startIndex !== -1 && endIndex !== -1) {
    const codeFixed = newCode.endsWith('\n') ? newCode : newCode + '\n'
    const before = lines.slice(0, startIndex + 1)
    const after = lines.slice(endIndex)
    const newContent = before.join('\n') + '\n' + codeFixed + after.join('\n')
    
    activeTab.value.model.setValue(newContent)
    // We don't update originalContent here because we want it to stay dirty 
    // until the user explicitly saves the file.
    dirty.value = true
    
    renderedMarkdown.value = renderMarkdown(newContent)
    await renderMermaidBlocks()
  }

  closeMermaidEditor()
}

let isRenderingMermaid = false
async function renderMermaidBlocks() {
  if (isRenderingMermaid) return
  isRenderingMermaid = true
  try {
    await nextTick()
    if (!mdPreviewRef.value) return
    const placeholders = mdPreviewRef.value.querySelectorAll('.mermaid-placeholder')
    if (!placeholders.length) return

    const mermaid = await loadMermaid()
    for (const el of placeholders) {
      const id = el.getAttribute('data-mermaid-id')
      const index = el.getAttribute('data-mermaid-index')
      const code = el.textContent
      try {
        const { svg } = await mermaid.render(id, code)
        el.innerHTML = svg
        el.classList.add('mermaid-rendered')
        // Make it interactive
        el.onclick = (e) => {
          e.preventDefault()
          e.stopPropagation()
          openMermaidEditor(index, code)
        }
        el.style.transition = 'transform 0.1s ease, box-shadow 0.1s ease'
        el.onmouseenter = () => { el.style.transform = 'scale(1.02)'; el.style.boxShadow = '0 4px 12px rgba(255, 255, 255, 0.05)' }
        el.onmouseleave = () => { el.style.transform = 'scale(1)'; el.style.boxShadow = 'none' }
      } catch (err) {
        console.error('Mermaid render error:', err)
        el.classList.add('mermaid-error')
      }
    }
  } finally {
    isRenderingMermaid = false
  }
}

async function toggleMarkdownEdit() {
  if (markdownEditMode.value) {
    if (editorInstance && activeTab.value?.type === 'file') {
      activeTab.value.originalContent = dirty.value ? editorInstance.getValue() : activeTab.value.originalContent
      renderedMarkdown.value = renderMarkdown(editorInstance.getValue())
    }
    markdownEditMode.value = false
    await renderMermaidBlocks()
  } else {
    markdownEditMode.value = true
    await nextTick()
    if (!editorInstance && editorContainerRef.value && activeTab.value?.type === 'file') {
      await createEditor(activeTab.value.path, activeTab.value.originalContent)
    } else if (editorInstance && activeTab.value?.type === 'file') {
      editorInstance.setModel(activeTab.value.model)
    }
  }
}

const EXT_TO_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  json: 'json', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  vue: 'html', svelte: 'html',
  md: 'markdown', yaml: 'yaml', yml: 'yaml',
  xml: 'xml', svg: 'xml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  ps1: 'powershell', psm1: 'powershell',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', c: 'c', cpp: 'cpp', h: 'cpp',
  cs: 'csharp', php: 'php', sql: 'sql',
  toml: 'ini', ini: 'ini', env: 'ini',
  dockerfile: 'dockerfile',
}

function getLang(filename) {
  const lower = filename.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  const ext = lower.split('.').pop()
  return EXT_TO_LANG[ext] || 'plaintext'
}

async function loadMonaco() {
  if (monacoModule.value) return monacoModule.value
  const monaco = await import('monaco-editor')

  self.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'json') return new Worker(new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url), { type: 'module' })
      if (label === 'css' || label === 'scss' || label === 'less') return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url), { type: 'module' })
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new Worker(new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url), { type: 'module' })
      if (label === 'typescript' || label === 'javascript') return new Worker(new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url), { type: 'module' })
      return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' })
    },
  }

  monacoModule.value = monaco
  return monaco
}

async function openFileView(filePath, goToLine, goToColumn, scrollTop) {
  const existingTab = tabs.value.find((t) => t.path === filePath)
  if (existingTab) {
    activeTabId.value = existingTab.id
    if (goToLine && editorInstance && existingTab.model) {
      editorInstance.revealLineInCenter(goToLine)
      editorInstance.setPosition({ lineNumber: goToLine, column: goToColumn || 1 })
      editorInstance.focus()
    }
    if (typeof scrollTop === 'number' && editorInstance) {
      editorInstance.setScrollTop(scrollTop)
    }
    return
  }

  if (isImageFile(filePath)) {
    fileError.value = null
    const src = `/api/processes/${encodeURIComponent(props.nodeGuid)}/file-raw?path=${encodeURIComponent(filePath)}`
    addTab({
      id: `file-${filePath}`,
      type: 'image',
      name: filePath.split('/').pop(),
      path: filePath,
      src,
    })
    return
  }

  fileLoading.value = true
  fileError.value = null
  dirty.value = false
  markdownEditMode.value = false
  renderedMarkdown.value = ''

  const res = await api(`/api/processes/${encodeURIComponent(props.nodeGuid)}/file?path=${encodeURIComponent(filePath)}`)
  fileLoading.value = false
  if (res.error) { fileError.value = res.error; return }

  const monaco = await loadMonaco()
  const model = markRaw(monaco.editor.createModel(res.content, getLang(filePath)))

  const newTab = {
    id: `file-${filePath}`,
    type: 'file',
    name: filePath.split('/').pop(),
    path: filePath,
    model: model,
    originalContent: res.content,
    isDirty: false,
  }

  addTab(newTab)

  if (filePath.toLowerCase().endsWith('.md')) {
    await loadMarked()
    renderedMarkdown.value = renderMarkdown(res.content)
    await renderMermaidBlocks()
  } else {
    await nextTick()
    await createEditor(filePath, res.content, goToLine, goToColumn, scrollTop)
  }
}

async function createEditor(filePath, content, goToLine, goToColumn, scrollTop) {
  if (!editorContainerRef.value) return

  const monaco = await loadMonaco()
  if (!editorInstance) {
    editorInstance = monaco.editor.create(editorContainerRef.value, {
      theme: 'vs-dark',
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'on',
      padding: { top: 8 },
    })

    editorInstance.onDidChangeModelContent(async () => {
      if (activeTab.value?.type === 'file') {
        const val = editorInstance.getValue()
        dirty.value = val !== activeTab.value.originalContent

        if (activeTab.value.path.toLowerCase().endsWith('.md')) {
          renderedMarkdown.value = renderMarkdown(val)
          await renderMermaidBlocks()
        }
      }
    })

    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (dirty.value) saveFile()
    })
  }

  if (activeTab.value?.type === 'file' && activeTab.value.model) {
    editorInstance.setModel(activeTab.value.model)
  }

  if (goToLine) {
    editorInstance.revealLineInCenter(goToLine)
    editorInstance.setPosition({ lineNumber: goToLine, column: goToColumn || 1 })
    editorInstance.focus()
  }
  if (typeof scrollTop === 'number') {
    editorInstance.setScrollTop(scrollTop)
  }
}

watch(activeTabId, async (newId) => {
  const tab = tabs.value.find((t) => t.id === newId)
  if (tab?.type === 'file') {
    if (tab.path.toLowerCase().endsWith('.md')) {
      if (!markdownEditMode.value) {
        renderedMarkdown.value = renderMarkdown(tab.model.getValue())
        await renderMermaidBlocks()
      }
    }
    await nextTick()
    if (editorContainerRef.value) {
      if (!editorInstance) {
        await createEditor(tab.path, tab.model.getValue())
      } else {
        editorInstance.setModel(tab.model)
        dirty.value = editorInstance.getValue() !== tab.originalContent
      }
    }
  }
})

function disposeEditor() {
  if (editorInstance) { editorInstance.dispose(); editorInstance = null }
  tabs.value.forEach((t) => {
    if (t.model) t.model.dispose()
  })
}

async function saveFile() {
  if (!editorInstance || activeTab.value?.type !== 'file') return
  saving.value = true
  const res = await api(`/api/processes/${encodeURIComponent(props.nodeGuid)}/file`, 'PUT', {
    path: activeTab.value.path,
    content: editorInstance.getValue(),
  })
  saving.value = false
  if (res.error) { fileError.value = res.error; return }
  activeTab.value.originalContent = editorInstance.getValue()
  dirty.value = false
}

async function refreshActiveFile() {
  if (!activeTab.value || activeTab.value.type !== 'file') return
  const filePath = activeTab.value.path
  const isDirty = editorInstance && editorInstance.getValue() !== activeTab.value.originalContent
  if (isDirty && !confirm('You have unsaved changes. Refreshing will overwrite them. Continue?')) return

  fileLoading.value = true
  fileError.value = null
  try {
    const res = await api(`/api/processes/${encodeURIComponent(props.nodeGuid)}/file?path=${encodeURIComponent(filePath)}`)
    if (res.error) {
      fileError.value = res.error
      return
    }
    activeTab.value.originalContent = res.content
    if (activeTab.value.model) {
      activeTab.value.model.setValue(res.content)
    }
    dirty.value = false
    if (filePath.toLowerCase().endsWith('.md')) {
      renderedMarkdown.value = renderMarkdown(res.content)
      await renderMermaidBlocks()
    }
  } catch (err) {
    fileError.value = err.message
  } finally {
    fileLoading.value = false
  }
}

// ── Embedded Terminal ───────────────────────
let isResizing = false
const terminalWidth = ref(parseInt(localStorage.getItem('xpm-ws-width')) || 420)
const wsTermContainerRef = ref(null)

function startResizing(e) {
  isResizing = true
  document.addEventListener('mousemove', doResizing)
  document.addEventListener('mouseup', stopResizing)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function doResizing(e) {
  if (!isResizing) return
  const modalRect = document.querySelector('.workspace-modal').getBoundingClientRect()
  const newWidth = modalRect.right - e.clientX
  if (newWidth > 200 && newWidth < modalRect.width - 200) {
    terminalWidth.value = newWidth
    localStorage.setItem('xpm-ws-width', newWidth)
    nextTick(() => fitWsTerm())
  }
}

function stopResizing() {
  isResizing = false
  document.removeEventListener('mousemove', doResizing)
  document.removeEventListener('mouseup', stopResizing)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}


function fileIcon(file) {
  if (file.isDirectory) return 'fa-solid fa-folder file-icon-dir'
  return fileIconByName(file.name)
}

function fileIconByName(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['js', 'ts', 'mjs', 'cjs', 'jsx', 'tsx'].includes(ext)) return 'fa-solid fa-file-code file-icon-code'
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return 'fa-solid fa-file-lines file-icon-config'
  if (['md', 'txt', 'rst'].includes(ext)) return 'fa-solid fa-file-lines file-icon-text'
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico'].includes(ext)) return 'fa-solid fa-file-image file-icon-image'
  return 'fa-solid fa-file file-icon-default'
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ── Lifecycle ───────────────────────────────
const initWorkspace = () => {
  if (props.show && props.nodeGuid) {
    currentPath.value = ''
    tabs.value = []
    activeTabId.value = null
    selectedFiles.value = []
    clearSearch()
    fetchFiles('')

    if (props.initialFile) {
      openFileView(props.initialFile, props.initialLine, props.initialColumn, props.initialScrollTop)
    }
  }
}

function snapshot() {
  if (!activeTab.value || activeTab.value.type !== 'file') return null
  const path = activeTab.value.path
  let line = null
  let column = null
  let scrollTop = null
  if (editorInstance) {
    const pos = editorInstance.getPosition()
    if (pos) { line = pos.lineNumber; column = pos.column }
    scrollTop = editorInstance.getScrollTop()
  }
  return { file: path, line, column, scrollTop }
}

defineExpose({ snapshot })

onMounted(() => {
  initWorkspace()
})

watch(() => props.show, (val) => {
  if (val) {
    initWorkspace()
  } else {
    disposeEditor()
    tabs.value = []
    activeTabId.value = null
    selectedFiles.value = []
    markdownEditMode.value = false
    renderedMarkdown.value = ''
  }
})

watch(() => props.nodeGuid, () => {
  if (props.show) {
    initWorkspace()
  }
})

watch([() => props.initialFile, () => props.initialLine], ([newFile, newLine]) => {
  if (newFile && props.show) {
    openFileView(newFile, newLine)
  }
})

</script>

<style scoped>
</style>
