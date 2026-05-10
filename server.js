const express = require('express');
const { spawn, execFileSync, exec } = require('child_process');
const kill = require('tree-kill');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const http = require('http');

const os = require('os');
const crypto = require('crypto');

function generateGuid() {
  return crypto.randomUUID();
}

// Ensure the running node's bin dir is in PATH (covers nvm-managed CLIs)
const nodeBinDir = path.dirname(process.execPath);
if (!process.env.PATH.split(':').includes(nodeBinDir)) {
  process.env.PATH = nodeBinDir + ':' + process.env.PATH;
}

// Ensure ~/.local/bin is in PATH (covers newly upgraded native CLIs like claude)
const localBinDir = path.join(os.homedir(), '.local', 'bin');
if (!process.env.PATH.split(':').includes(localBinDir)) {
  process.env.PATH = localBinDir + ':' + process.env.PATH;
}

// Ensure standard macOS binary paths are in PATH (crucial for launchd/background services)
['/usr/local/bin', '/opt/homebrew/bin'].forEach(dir => {
  if (fs.existsSync(dir) && !process.env.PATH.split(':').includes(dir)) {
    process.env.PATH = dir + ':' + process.env.PATH;
  }
});

const systemConfigPath = path.join(__dirname, 'system.config.json');
const systemConfig = fs.existsSync(systemConfigPath) ? JSON.parse(fs.readFileSync(systemConfigPath, 'utf-8')) : {};

const cliInfoPath = path.join(__dirname, 'cli.info.json');
const cliInfo = fs.existsSync(cliInfoPath) ? JSON.parse(fs.readFileSync(cliInfoPath, 'utf-8')) : [];
const allowedSessionCmds = new Set(cliInfo.map((c) => c && c.ls).filter(Boolean));

const app = express();
const PORT = parseInt(process.env.PORT) || systemConfig.port || 1337;
const MAX_LOG_LINES = systemConfig.maxLogLines || 500;

const configPath = path.join(__dirname, 'processes.config.json');
let processConfigs = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : [];
// Filter out any null/undefined entries that might have leaked in
processConfigs = processConfigs.filter(c => c && typeof c === 'object');
let configChanged = false;

processConfigs = processConfigs.map(c => {
  if (!c.guid) {
    c.guid = generateGuid();
    configChanged = true;
  }
  return c;
});

if (configChanged) {
  saveConfig();
}

const envConfigPath = path.join(__dirname, 'env.config.json');
let envVars = {};
if (fs.existsSync(envConfigPath)) {
  envVars = JSON.parse(fs.readFileSync(envConfigPath, 'utf-8'));
}

const groupsConfigPath = path.join(__dirname, 'groups.config.json');
const toolsConfigPath = path.join(__dirname, 'tools.config.json');
const skillsDir = path.join(__dirname, 'skills');
const DEFAULT_GROUP_DEFS = [
  { name: 'infra', color: '#a78bfa' },
  { name: 'frontend', color: '#60a5fa' },
  { name: 'backend', color: '#34d399' },
];
const DEFAULT_PALETTE = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#fb923c', '#38bdf8'];

function isValidHexColor(s) {
  return typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
}

function normalizeGroupEntry(raw, index) {
  if (typeof raw === 'string') {
    const name = raw.trim();
    if (!name) return null;
    return { 
      guid: generateGuid(),
      name, 
      color: DEFAULT_PALETTE[index % DEFAULT_PALETTE.length] 
    };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const name = String(raw.name ?? '').trim();
    if (!name) return null;
    let color = String(raw.color ?? '').trim();
    if (!isValidHexColor(color)) {
      color = DEFAULT_PALETTE[index % DEFAULT_PALETTE.length];
    } else {
      color = color.toLowerCase();
      if (color.length === 4) {
        color = `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
      }
    }
    return { 
      guid: raw.guid || generateGuid(),
      name, 
      color 
    };
  }
  return null;
}

function normalizeGroupList(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const out = [];
  const seenNames = new Set();
  const seenGuids = new Set();
  for (let i = 0; i < parsed.length; i++) {
    const entry = normalizeGroupEntry(parsed[i], i);
    if (!entry) continue;
    if (seenNames.has(entry.name)) continue;
    seenNames.add(entry.name);
    
    // Ensure GUID uniqueness if one was provided but duplicated
    if (seenGuids.has(entry.guid)) {
      entry.guid = generateGuid();
    }
    seenGuids.add(entry.guid);
    
    out.push(entry);
  }
  return out.length ? out : null;
}

let groupList = normalizeGroupList(DEFAULT_GROUP_DEFS) || [...DEFAULT_GROUP_DEFS];
let groupsChanged = false;

if (fs.existsSync(groupsConfigPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(groupsConfigPath, 'utf-8'));
    const normalized = normalizeGroupList(parsed);
    if (normalized) {
      groupList = normalized;
      // If normalization added GUIDs or fixed types, save it
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        groupsChanged = true;
      }
    }
  } catch {
    groupList = normalizeGroupList(DEFAULT_GROUP_DEFS) || [...DEFAULT_GROUP_DEFS];
    groupsChanged = true;
  }
} else {
  groupsChanged = true;
}

if (groupsChanged) {
  saveGroupsConfig();
}


let toolsList = [];
if (fs.existsSync(toolsConfigPath)) {
  try {
    toolsList = JSON.parse(fs.readFileSync(toolsConfigPath, 'utf-8'));
    if (!Array.isArray(toolsList)) toolsList = [];
  } catch {
    toolsList = [];
  }
}

function saveGroupsConfig() {
  fs.writeFileSync(groupsConfigPath, JSON.stringify(groupList, null, 2) + '\n');
}

function saveToolsConfig() {
  fs.writeFileSync(toolsConfigPath, JSON.stringify(toolsList, null, 2) + '\n');
}

// ── Skills ──────────────────────────────────────────────────────────────
// Skills live under ./skills/<name>/SKILL.md (folder per skill so companion
// files like references/ and scripts/ can sit alongside). The UI surfaces
// only name + description from frontmatter; the body is edited externally
// (or replaced via upload). See cli-unification.md.

const SKILL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function isValidSkillName(name) {
  return typeof name === 'string' && SKILL_NAME_RE.test(name);
}

function parseSkillFrontmatter(text) {
  if (typeof text !== 'string') return { meta: {}, body: '' };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[kv[1]] = v;
  }
  return { meta, body: m[2] };
}

function serializeSkillFile(meta, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    const s = String(v);
    const needsQuote = /[:#\n]/.test(s);
    lines.push(`${k}: ${needsQuote ? JSON.stringify(s) : s}`);
  }
  lines.push('---', '', body || '');
  return lines.join('\n');
}

function readSkillRow(name) {
  if (!isValidSkillName(name)) return null;
  const file = path.join(skillsDir, name, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  try {
    const { meta } = parseSkillFrontmatter(fs.readFileSync(file, 'utf-8'));
    return {
      name,
      description: meta.description || '',
    };
  } catch {
    return { name, description: '' };
  }
}

function listSkills() {
  if (!fs.existsSync(skillsDir)) return [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const row = readSkillRow(e.name);
    if (row) out.push(row);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function writeSkillFile(name, description, body) {
  const dir = path.join(skillsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  let existingBody = body;
  if (existingBody === undefined && fs.existsSync(file)) {
    existingBody = parseSkillFrontmatter(fs.readFileSync(file, 'utf-8')).body;
  }
  fs.writeFileSync(file, serializeSkillFile({ name, description: description || '' }, existingBody || '\n# Instructions\n\n'));
}

function deleteSkill(name) {
  if (!isValidSkillName(name)) return;
  const dir = path.join(skillsDir, name);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function renameSkill(oldName, newName) {
  if (!isValidSkillName(oldName) || !isValidSkillName(newName)) return false;
  if (oldName === newName) return true;
  const oldDir = path.join(skillsDir, oldName);
  const newDir = path.join(skillsDir, newName);
  if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) return false;
  fs.renameSync(oldDir, newDir);
  return true;
}

function saveConfig() {
  const cleanConfigs = processConfigs.filter(c => c && typeof c === 'object');
  fs.writeFileSync(configPath, JSON.stringify(cleanConfigs, null, 2) + '\n');
}

function saveEnvConfig() {
  fs.writeFileSync(envConfigPath, JSON.stringify(envVars, null, 2) + '\n');
}

const processes = new Map();

// WebSocket clients per process: Map<processName, Set<WebSocket>>
const wsClients = new Map();

function broadcastPtyData(name, data) {
  const clients = wsClients.get(name);
  if (!clients || clients.size === 0) return;
  for (const ws of clients) {
    try { if (ws.readyState === 1) ws.send(data); } catch {}
  }
}

function disconnectPtyClients(name) {
  const clients = wsClients.get(name);
  if (!clients) return;
  for (const ws of clients) {
    try { ws.close(1000, 'PTY exited'); } catch {}
  }
}

// Global UI broadcast channel — for notifications, focus, etc.
// Targets every connected UI client, not a specific process.
const uiClients = new Set();
function broadcastUi(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of uiClients) {
    try { if (ws.readyState === 1) ws.send(msg); } catch {}
  }
}

function findCard(idOrName) {
  if (!idOrName) return null;
  const key = String(idOrName);
  return processConfigs.find(c => c.guid === key)
      || processConfigs.find(c => c.name === key)
      || null;
}

const INPUT_PATTERNS = [
  /\?\s*$/m,           // lines ending with "?"
  />\s*$/m,            // interactive caret prompts
  /:\s*$/m,            // colons (password/input prompts)
  /[$#]\s*$/m,         // shell prompts ($ or #)
  /press enter/i,
  /\([yY]\/[nN]\)/,
  /do you want to/i,
];

function stripAnsi(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-4]?[ORZcf-nqry=><]/g, '');
}

// Sticky ready detection: once an interactive signal is seen we keep
// needsInput=true until the process restarts. This avoids false "busy" flips
// when a TUI redraws and momentarily emits ?2004l/?25l during its render.
// Signals (any one is sufficient):
//   ?2004h  bracketed paste enabled — set by Claude/Cursor/most readline CLIs
//   ?1049h  alt-screen entered — set by Ink-based TUIs (Gemini, etc.)
const RAW_READY_PATTERNS = [
  /\x1b\[\?2004h/,
  /\x1b\[\?1049h/,
];

function checkNeedsInput(entry, text) {
  if (!entry || entry.needsInput) return;

  if (typeof text === 'string' && RAW_READY_PATTERNS.some(p => p.test(text))) {
    entry.needsInput = true;
    return;
  }

  // Fallback for shell-style CLIs that don't use bracketed paste / alt screen
  const lastLogs = entry.logs.slice(-5).map(l => l.text).join('');
  const cleanText = stripAnsi(lastLogs);

  const isPromptLike = cleanText.length > 0 && !cleanText.endsWith('\n') && !cleanText.endsWith('\r');

  if (isPromptLike || INPUT_PATTERNS.some(p => p.test(cleanText))) {
    entry.needsInput = true;
  }
}

function resolveTemplate(str) {
  if (!str) return str;
  let resolved = str.replace(/\{(\w+)\}/g, (match, key) => {
    return envVars[key] !== undefined ? envVars[key] : match;
  });
  if (resolved.startsWith('~')) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  return resolved;
}

function getGitBranch(cwd) {
  if (!cwd) return null;
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'], // suppress stderr for non-git working directories
    }).trim();
  } catch {
    return null;
  }
}

function getState(id) {
  const entry = processes.get(id);
  if (!entry) return { status: 'stopped', pid: null, logs: [], startedAt: null };
  return {
    status: entry.status,
    pid: entry.proc?.pid ?? null,
    logs: entry.logs,
    startedAt: entry.startedAt,
    needsInput: entry.needsInput || false,
  };
}

let pty;
try {
  pty = require('node-pty-prebuilt-multiarch');
} catch(e1) {
  try {
    pty = require('node-pty');
  } catch(e2) {}
}

const { stripVTControlCharacters } = require('util');

function cleanAnsiLog(line) {
  // 1. Handle carriage returns properly. Take the final state in this line segment.
  const segments = line.split('\r');
  let text = segments[segments.length - 1];
  
  // 2. Strip non-color ANSI sequences (CSI sequences ending in A-L or N-Z etc.)
  // Keep sequences ending in 'm' (SGR)
  return text.replace(/\x1b\[[0-9;]*([A-LN-Z])/g, '');
}

function appendLog(entry, source, data) {
  const rawData = data.toString();
  // Split raw stream by newline
  const lines = rawData.split('\n');
  
  for (const line of lines) {
    if (line.length === 0) continue;

    // Clean the line (handle overwrites and strip movement codes)
    const cleanedLine = cleanAnsiLog(line);
    const visibleText = stripVTControlCharacters(cleanedLine).trim();
    
    // Drop single spinner characters or empty lines that spam raw logs
    const spinners = ['✻', '◐', '◓', '◑', '◒', '...', '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    if (spinners.includes(visibleText)) continue;
    
    // De-duplicate if the last log is identical (anti-spam for redraws)
    const lastLog = entry.logs[entry.logs.length - 1];
    if (lastLog && stripVTControlCharacters(lastLog.text).trim() === visibleText && lastLog.source === source) {
      continue;
    }
    
    // Push the line with preserved colors to Vue
    entry.logs.push({ ts: Date.now(), source, text: cleanedLine });
    if (entry.logs.length > MAX_LOG_LINES) entry.logs.shift();
  }
}

function normalizeOnSuccess(value) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const arr = value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
    return arr.length > 0 ? arr : undefined;
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function triggerOnSuccess(entry, config) {
  if (!config.onSuccess) return;
  const targets = Array.isArray(config.onSuccess) ? config.onSuccess : [config.onSuccess];
  for (const target of targets) {
    if (!target) continue;
    // onSuccess in user configs is written by name; resolve to guid here.
    const targetConfig = processConfigs.find((c) => c.guid === target || c.name === target);
    if (!targetConfig) {
      appendLog(entry, 'system', `onSuccess: unknown target "${target}"`);
      continue;
    }
    appendLog(entry, 'system', `onSuccess: triggering "${target}"`);
    setImmediate(() => {
      const result = startProcess(targetConfig.guid);
      if (result && result.error) appendLog(entry, 'system', `onSuccess "${target}" failed: ${result.error}`);
    });
  }
}

function getGeminiPath() {
  const possible = ['/usr/local/bin/gemini', '/opt/homebrew/bin/gemini', 'gemini'];
  for (const p of possible) {
    if (p.startsWith('/') && fs.existsSync(p)) return p;
  }
  return 'gemini';
}

function getProcessEnv() {
  const env = { ...process.env, PYTHONUNBUFFERED: '1', ...envVars };
  if (envVars.PATH) {
    // If the user provided a custom PATH, prepend it to the current PATH
    // to ensure it takes precedence without losing standard system paths.
    env.PATH = envVars.PATH + (process.env.PATH ? ':' + process.env.PATH : '');
  }
  return env;
}

function startProcess(id, resumeId = null) {
  const config = processConfigs.find((c) => c.guid === id);
  if (!config) return { error: `Unknown process identifier: ${id}` };
  const name = config.name;
  const guid = config.guid;

  const existing = processes.get(guid);
  if (existing && existing.status === 'running') {
    return { error: `${name} is already running` };
  }

  const resolvedCwd = resolveTemplate(config.cwd);
  let resolvedArgs = (config.args || []).map(resolveTemplate);

  if (resumeId) {
    // Both gemini and claude accept `--resume <id>` (or `-r <id>`).
    const cmdLine = `${config.command} ${resolvedArgs.join(' ')}`;
    const supportsResume = cmdLine.includes('gemini') || cmdLine.includes('claude');
    if (supportsResume) {
      const idx = resolvedArgs.findIndex(a => a === '-r' || a === '--resume');
      if (idx !== -1) {
        resolvedArgs[idx + 1] = resumeId;
      } else {
        resolvedArgs.push('--resume', resumeId);
      }
    }
  }

  const env = getProcessEnv();
  let proc;
  const entry = {
    status: 'running',
    logs: [{ ts: Date.now(), source: 'system', text: `Spawning: ${config.command} ${resolvedArgs.join(' ')}` }],
    ptyRawBuffer: '',       // Raw PTY output for faithful xterm replay
    logRawBuffer: '',       // Raw non-PTY output for faithful xterm replay
    startedAt: Date.now(),
    config,
  };

  try {
    if (pty && config.usePty) {
      console.log(`[xpm] Spawning (pty): ${config.command} ${JSON.stringify(resolvedArgs)} cwd=${resolvedCwd || '(none)'}`);
      proc = pty.spawn('/usr/bin/env', [config.command, ...resolvedArgs], {
        name: 'xterm-256color',
        cols: 100,
        rows: 40,
        cwd: resolvedCwd || process.cwd(),
        env
      });

      entry.ptyProc = proc;  // Keep raw PTY ref for WebSocket resize/write

      proc.onData((data) => {
        appendLog(entry, 'stdout', data);
        broadcastPtyData(guid, data);
        checkNeedsInput(entry, data.toString());
        // Buffer raw output for faithful replay on late-connecting terminals
        entry.ptyRawBuffer += data;
        // Cap buffer at ~256KB to avoid unbounded memory growth
        if (entry.ptyRawBuffer.length > 256 * 1024) {
          entry.ptyRawBuffer = entry.ptyRawBuffer.slice(-128 * 1024);
        }
      });

      proc.onExit(({ exitCode }) => {
        const wasStopping = entry.status === 'stopping';
        if (!wasStopping) {
          entry.status = exitCode === 0 ? 'stopped' : 'errored';
        } else {
          entry.status = 'stopped';
        }
        appendLog(entry, 'system', `Exited with code ${exitCode}`);
        entry.proc = null;
        entry.ptyProc = null;
        disconnectPtyClients(guid);
        if (!wasStopping && exitCode === 0) triggerOnSuccess(entry, config);
      });
    } else {
      console.log(`[xpm] Spawning: ${config.command} ${JSON.stringify(resolvedArgs)} cwd=${resolvedCwd || '(none)'}`);
      proc = spawn(config.command, resolvedArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: resolvedCwd || undefined,
        env
      });

      const handleData = (data) => {
        appendLog(entry, 'stdout', data);
        broadcastPtyData(guid, data);
        checkNeedsInput(entry, data.toString());
        entry.logRawBuffer += data;
        if (entry.logRawBuffer.length > 256 * 1024) {
          entry.logRawBuffer = entry.logRawBuffer.slice(-128 * 1024);
        }
      };

      proc.stdout.on('data', handleData);
      proc.stderr.on('data', handleData);

      proc.on('error', (err) => {
        entry.status = 'errored';
        appendLog(entry, 'system', `Process error: ${err.message}`);
      });

      proc.on('close', (code) => {
        const wasStopping = entry.status === 'stopping';
        if (!wasStopping) {
          entry.status = code === 0 ? 'stopped' : 'errored';
        } else {
          entry.status = 'stopped';
        }
        appendLog(entry, 'system', `Exited with code ${code}`);
        entry.proc = null;
        disconnectPtyClients(guid);
        if (!wasStopping && code === 0) triggerOnSuccess(entry, config);
      });
    }
  } catch (err) {
    entry.status = 'errored';
    appendLog(entry, 'system', `Failed to start process: ${err.message}`);
    processes.set(guid, entry);
    return { error: err.message };
  }

  // To support both pty.js (write) and child_process.spawn (stdin.write)
  entry.proc = {
    stdin: proc.stdin || {
      write: (data) => proc.write(data),
      destroyed: false
    },
    pid: proc.pid,
    kill: (signal) => proc.kill(signal)
  };

  processes.set(guid, entry);
  return { ok: true };
}

function spawnChat(parentGuid, { instruction, resumeId, title, cols, rows } = {}) {
  const config = processConfigs.find((c) => c.guid === parentGuid);
  if (!config) return { error: `Unknown process identifier: ${parentGuid}` };
  if ((config.type || 'service') !== 'agent') {
    return { error: `Process ${parentGuid} is not of type 'agent'` };
  }
  if (!pty || !config.usePty) {
    return { error: `Chat requires a PTY-enabled agent` };
  }
  const hasInstruction = typeof instruction === 'string' && instruction.trim().length > 0;
  if (!hasInstruction && !resumeId) {
    return { error: 'Instruction is required' };
  }

  const chatId = `${parentGuid}::chat::${generateGuid()}`;
  const resolvedCwd = resolveTemplate(config.cwd);
  const baseArgs = (config.args || []).map(resolveTemplate);

  if (resumeId) {
    const cmdLine = `${config.command} ${baseArgs.join(' ')}`;
    const supportsResume = cmdLine.includes('gemini') || cmdLine.includes('claude');
    if (supportsResume) {
      const idx = baseArgs.findIndex((a) => a === '-r' || a === '--resume');
      if (idx !== -1) baseArgs[idx + 1] = resumeId;
      else baseArgs.push('--resume', resumeId);
    }
  }

  const resolvedArgs = hasInstruction ? [...baseArgs, instruction] : baseArgs;
  const env = getProcessEnv();

  const entry = {
    status: 'running',
    logs: [{ ts: Date.now(), source: 'system', text: `Spawning chat: ${config.command} ${resolvedArgs.join(' ')}` }],
    ptyRawBuffer: '',
    logRawBuffer: '',
    startedAt: Date.now(),
    config,
    parentGuid,
    instruction: hasInstruction ? instruction : null,
    resumeId: resumeId || null,
    title: title || null,
  };

  let proc;
  try {
    console.log(`[xpm] Spawning chat (pty): ${config.command} ${JSON.stringify(resolvedArgs)} cwd=${resolvedCwd || '(none)'}`);
    // Honor the client's intended cols/rows so the very first agent draw
    // (e.g. claude --resume re-rendering the transcript) is formatted for
    // the actual chat panel width. Without this the buffer is captured at
    // 100 cols and replayed into a narrower xterm, garbling line wraps.
    const initialCols = Number.isFinite(cols) ? Math.max(20, Math.min(300, Math.floor(cols))) : 100;
    const initialRows = Number.isFinite(rows) ? Math.max(5, Math.min(100, Math.floor(rows))) : 40;
    proc = pty.spawn('/usr/bin/env', [config.command, ...resolvedArgs], {
      name: 'xterm-256color',
      cols: initialCols,
      rows: initialRows,
      cwd: resolvedCwd || process.cwd(),
      env,
    });

    entry.ptyProc = proc;

    proc.onData((data) => {
      appendLog(entry, 'stdout', data);
      broadcastPtyData(chatId, data);
      checkNeedsInput(entry, data.toString());
      entry.ptyRawBuffer += data;
      if (entry.ptyRawBuffer.length > 256 * 1024) {
        entry.ptyRawBuffer = entry.ptyRawBuffer.slice(-128 * 1024);
      }
    });

    proc.onExit(({ exitCode }) => {
      const wasStopping = entry.status === 'stopping';
      entry.status = wasStopping ? 'stopped' : (exitCode === 0 ? 'stopped' : 'errored');
      appendLog(entry, 'system', `Exited with code ${exitCode}`);
      entry.proc = null;
      entry.ptyProc = null;
      disconnectPtyClients(chatId);
    });
  } catch (err) {
    entry.status = 'errored';
    appendLog(entry, 'system', `Failed to start chat: ${err.message}`);
    processes.set(chatId, entry);
    return { error: err.message };
  }

  entry.proc = {
    stdin: { write: (data) => proc.write(data), destroyed: false },
    pid: proc.pid,
    kill: (signal) => proc.kill(signal),
  };

  processes.set(chatId, entry);
  return {
    ok: true,
    chatId,
    instruction: entry.instruction,
    title: entry.title,
    resumeId: entry.resumeId,
    startedAt: entry.startedAt,
    status: entry.status,
  };
}

function killChat(chatId) {
  const entry = processes.get(chatId);
  if (!entry || !entry.parentGuid) {
    return { error: `Chat "${chatId}" not found` };
  }
  if (entry.status === 'running' && entry.proc) {
    entry.status = 'stopping';
    try {
      kill(entry.proc.pid, 'SIGTERM', (err) => {
        if (err) appendLog(entry, 'system', `Kill error: ${err.message}`);
      });
    } catch (err) {
      appendLog(entry, 'system', `Kill error: ${err.message}`);
    }
  }
  processes.delete(chatId);
  disconnectPtyClients(chatId);
  return { ok: true };
}

function listChats(parentGuid) {
  const result = [];
  for (const [id, entry] of processes.entries()) {
    if (entry.parentGuid !== parentGuid) continue;
    result.push({
      chatId: id,
      instruction: entry.instruction,
      title: entry.title || null,
      resumeId: entry.resumeId || null,
      startedAt: entry.startedAt,
      status: entry.status,
      needsInput: entry.needsInput || false,
    });
  }
  result.sort((a, b) => a.startedAt - b.startedAt);
  return result;
}

function stopProcess(id) {
  const config = processConfigs.find((c) => c.guid === id);
  const guid = config?.guid || id;
  const entry = processes.get(guid);
  if (!entry || entry.status !== 'running' || !entry.proc) {
    return { error: `${id} is not running` };
  }

  entry.status = 'stopping';
  const processConfig = entry.config;

  if (processConfig.stopCommand) {
    spawn(processConfig.stopCommand.command, processConfig.stopCommand.args || [], {
      stdio: 'ignore',
    });
    setTimeout(() => {
      if (entry.proc) {
        kill(entry.proc.pid, 'SIGKILL');
      }
    }, 5000);
  } else {
    kill(entry.proc.pid, 'SIGTERM', (err) => {
      if (err) {
        appendLog(entry, 'system', `Kill error: ${err.message}`);
      }
    });
  }

  return { ok: true };
}

// Serve Vue build output from dist/, fall back to legacy public/
const distDir = path.join(__dirname, 'dist');
const publicDir = path.join(__dirname, 'public');

app.use(express.json({ limit: '50mb' }));
app.get('/api/processes', (_req, res) => {
  const chatCounts = new Map();
  for (const entry of processes.values()) {
    if (!entry.parentGuid || entry.status !== 'running') continue;
    chatCounts.set(entry.parentGuid, (chatCounts.get(entry.parentGuid) || 0) + 1);
  }
  const result = processConfigs.map((config) => {
    const state = getState(config.guid);
    const resolvedCwd = resolveTemplate(config.cwd);
    return {
      guid: config.guid,
      name: config.name,
      type: config.type || 'service',
      group: config.group,
      command: `${config.command} ${(config.args || []).map(resolveTemplate).join(' ')}`.trim(),
      cwd: config.cwd || null,
      resolvedCwd: resolvedCwd || null,
      branch: getGitBranch(resolvedCwd),
      usePty: !!config.usePty,
      tools: config.tools || [],
      status: state.status,
      pid: state.pid,
      startedAt: state.startedAt,
      needsInput: state.needsInput,
      chatCount: chatCounts.get(config.guid) || 0,
    };
  });
  res.json(result);
});

app.get('/api/system', (req, res) => {
  res.json({
    port: systemConfig.port || 1337,
    maxLogLines: systemConfig.maxLogLines || 500,
    terminalWidth: systemConfig.terminalWidth || 120,
    logPollInterval: systemConfig.logPollInterval || 500,
    statusPollInterval: systemConfig.statusPollInterval || 3000,
    popoverPollInterval: systemConfig.popoverPollInterval || 1500,
  });
});

app.get('/api/processes/:id/logs', (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const state = getState(req.params.id);
  const logs = state.logs.filter((l) => l.ts > since);
  res.json(logs);
});

app.use(express.text({ limit: '50mb' }));

app.post('/api/processes/:id/stdin', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  const guid = config?.guid || id;
  const entry = processes.get(guid);
  if (!entry || entry.status !== 'running' || !entry.proc) {
    return res.status(400).json({ error: `${id} is not running` });
  }
  if (!entry.proc.stdin || entry.proc.stdin.destroyed) {
    return res.status(400).json({ error: `${id} stdin is not available` });
  }
  
  entry.needsInput = false;
  
  const input = req.body.input !== undefined ? req.body.input : (typeof req.body === 'string' ? req.body : '');
  // Send exactly \r (Return key payload) because Raw mode drops \n and \r\n can confuse TUI prompts
  entry.proc.stdin.write(input + '\r');
  appendLog(entry, 'stdin', input);
  res.json({ ok: true });
});

function sortSessions(sessions) {
  // Sort newest-first. Prefer Date.parse on the time string; fall back to index
  // (gemini's --list-sessions emits oldest-first, so highest index = newest).
  return sessions.slice().sort((a, b) => {
    const at = Date.parse(a.time);
    const bt = Date.parse(b.time);
    if (!isNaN(at) && !isNaN(bt) && at !== bt) return bt - at;
    return b.index - a.index;
  });
}

function listGeminiSessions(cwd) {
  return new Promise((resolve, reject) => {
    const gemini = getGeminiPath();
    const execOpts = { env: { ...process.env, ...envVars } };
    if (cwd && fs.existsSync(cwd)) execOpts.cwd = cwd;

    const parse = (out) => {
      const sessions = [];
      const regex = /^\s*(\d+)\.\s+(.+?)\s+\((.+?)\)\s+\[(.+?)\]/;
      for (const line of out.split('\n')) {
        const m = line.match(regex);
        if (m) sessions.push({ index: parseInt(m[1]), title: m[2], time: m[3], id: m[4] });
      }
      return sortSessions(sessions);
    };

    const cmd = gemini.startsWith('/') ? `node "${gemini}"` : gemini;
    exec(`${cmd} --list-sessions`, execOpts, (error, stdout, stderr) => {
      if (error && !stdout) return reject({ error: error.message, stderr });
      resolve(parse(stdout));
    });
  });
}

app.get('/api/gemini/sessions', (req, res) => {
  listGeminiSessions()
    .then((sessions) => res.json(sessions))
    .catch((err) => res.status(500).json(err));
});

app.get('/api/processes/:id/sessions', (req, res) => {
  const config = processConfigs.find((c) => c.guid === req.params.id);
  if (!config) return res.status(404).json({ error: `Unknown process identifier: ${req.params.id}` });
  listGeminiSessions(resolveTemplate(config.cwd))
    .then((sessions) => res.json(sessions))
    .catch((err) => res.status(500).json(err));
});

function extractClaudeSessionTitle(filePath) {
  // Claude Code transcripts are JSONL. The session title (when claude has
  // synthesized one) appears as a {type:"ai-title", aiTitle:"..."} record;
  // the earliest user message is the fallback. Both land in the first chunk
  // of the file, so we read a bounded prefix for speed.
  try {
    const stat = fs.statSync(filePath);
    const max = Math.min(stat.size, 64 * 1024);
    if (max <= 0) return null;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(max);
    fs.readSync(fd, buf, 0, max, 0);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    let firstUser = null;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'ai-title' && obj.aiTitle) return String(obj.aiTitle).slice(0, 200);
      if (!firstUser && obj.type === 'user' && obj.message?.role === 'user') {
        const content = obj.message.content;
        if (typeof content === 'string') firstUser = content;
        else if (Array.isArray(content)) {
          const textPart = content.find((c) => c && (typeof c === 'string' || c.type === 'text'));
          if (textPart) firstUser = typeof textPart === 'string' ? textPart : textPart.text;
        }
      }
    }
    return firstUser ? String(firstUser).replace(/\s+/g, ' ').trim().slice(0, 200) : null;
  } catch {
    return null;
  }
}

function listClaudeSessions(cwd) {
  return new Promise((resolve) => {
    if (!cwd) return resolve([]);
    const home = process.env.HOME || os.homedir();
    const encoded = cwd.replace(/[^A-Za-z0-9_-]/g, '-');
    const dir = path.join(home, '.claude', 'projects', encoded);
    if (!fs.existsSync(dir)) return resolve([]);

    let entries;
    try { entries = fs.readdirSync(dir); } catch { return resolve([]); }

    const sessions = [];
    let index = 1;
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(dir, file);
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }
      const sessionId = file.slice(0, -'.jsonl'.length);
      const title = extractClaudeSessionTitle(filePath) || sessionId;
      sessions.push({
        index: index++,
        title,
        time: stat.mtime.toISOString(),
        id: sessionId,
      });
    }
    resolve(sortSessions(sessions));
  });
}

function listProviderSessions(cwd, cmd) {
  return new Promise((resolve, reject) => {
    // Reject anything not declared in cli.info.json. Without this gate the
    // endpoint would exec arbitrary shell strings supplied by the client.
    if (!allowedSessionCmds.has(cmd)) {
      return reject({ error: `Session command not allowed: ${cmd}` });
    }

    // Claude Code has no `--list-sessions` command; sessions live as JSONL
    // transcripts under ~/.claude/projects/<encoded-cwd>/. Route to the
    // filesystem adapter when the configured cmd targets claude.
    if (cmd.includes('claude')) {
      listClaudeSessions(cwd).then(resolve).catch(reject);
      return;
    }
    // If the command appears to be a gemini call, reuse the gemini parser.
    if (cmd.includes('gemini')) {
      const parts = cmd.split(' ');
      const execCmd = parts[0];
      const args = parts.slice(1);
      const execOpts = { env: getProcessEnv() };
      if (cwd && fs.existsSync(cwd)) execOpts.cwd = cwd;
      exec(`${execCmd} ${args.join(' ')}`, execOpts, (error, stdout, stderr) => {
        if (error && !stdout) return reject({ error: error.message, stderr });
        const sessions = [];
        const regex = /^\s*(\d+)\.\s+(.+?)\s+\((.+?)\)\s+\[(.+?)\]/;
        for (const line of stdout.split('\n')) {
          const m = line.match(regex);
          if (m) sessions.push({ index: parseInt(m[1]), title: m[2], time: m[3], id: m[4] });
        }
        resolve(sortSessions(sessions));
      });
      return;
    }
    // Allowlisted but unrecognized provider — exec the configured command
    // and return raw lines. Safe because cmd is constrained to cli.info.json.
    const execOpts = { env: getProcessEnv() };
    if (cwd && fs.existsSync(cwd)) execOpts.cwd = cwd;
    exec(cmd, execOpts, (error, stdout, stderr) => {
      if (error && !stdout) return reject({ error: error.message, stderr });
      const lines = stdout.split('\n').filter(l => l.trim());
      resolve(lines.map(l => ({ raw: l })));
    });
  });
}

// Endpoint for provider-specific session listing.
app.get('/api/processes/:id/provider-sessions', async (req, res) => {
  const config = processConfigs.find(c => c.guid === req.params.id);
  if (!config) return res.status(404).json({ error: `Unknown process identifier: ${req.params.id}` });
  const cmd = req.query.cmd;
  if (!cmd) return res.status(400).json({ error: 'Missing cmd query parameter' });
  if (!allowedSessionCmds.has(cmd)) {
    return res.status(400).json({ error: `Session command not allowed: ${cmd}` });
  }
  try {
    const sessions = await listProviderSessions(resolveTemplate(config.cwd), cmd);
    res.json(sessions);
  } catch (err) {
    res.status(500).json(err);
  }
});

app.post('/api/processes/:id/start', (req, res) => {
  res.json(startProcess(req.params.id));
});

app.get('/api/processes/:parentId/chats', (req, res) => {
  res.json(listChats(req.params.parentId));
});

app.post('/api/processes/:parentId/chats', (req, res) => {
  const { instruction, resumeId, title, cols, rows } = req.body || {};
  const result = spawnChat(req.params.parentId, { instruction, resumeId, title, cols, rows });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/processes/:parentId/chats/:chatId', (req, res) => {
  const { parentId, chatId } = req.params;
  const entry = processes.get(chatId);
  if (!entry || entry.parentGuid !== parentId) {
    return res.status(404).json({ error: `Chat "${chatId}" not found for parent "${parentId}"` });
  }
  res.json(killChat(chatId));
});

app.post('/api/processes/:id/resume/:resumeId', async (req, res) => {
  const { id, resumeId } = req.params;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config) return res.status(404).json({ error: `Unknown process identifier: ${id}` });

  try {
    const sessions = await listGeminiSessions(resolveTemplate(config.cwd));
    const found = sessions.some((s) => s.id === resumeId || String(s.index) === String(resumeId));
    if (!found) {
      return res.status(404).json({
        error: `Session "${resumeId}" is no longer available. The session list may be stale — refresh and try again.`,
        staleSession: true,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: `Failed to verify session: ${err.error || err.message}` });
  }

  res.json(startProcess(id, resumeId));
});

app.post('/api/processes/:id/stop', (req, res) => {
  res.json(stopProcess(req.params.id));
});

app.post('/api/processes/:id/restart', async (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  const guid = config?.guid || id;
  const entry = processes.get(guid);
  if (entry && entry.status === 'running') {
    stopProcess(id);
    const wait = () =>
      new Promise((resolve) => {
        const check = setInterval(() => {
          const s = getState(id);
          if (s.status !== 'running' && s.status !== 'stopping') {
            clearInterval(check);
            resolve();
          }
        }, 200);
        setTimeout(() => {
          clearInterval(check);
          resolve();
        }, 10000);
      });
    await wait();
  }
  res.json(startProcess(id));
});

app.get('/api/processes/:id/files', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });

  const resolvedCwd = resolveTemplate(config.cwd);
  const subPath = req.query.path || '';
  const targetDir = subPath ? path.resolve(resolvedCwd, subPath) : resolvedCwd;

  // Prevent directory traversal outside the workspace
  if (!targetDir.startsWith(resolvedCwd)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const files = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        size: e.isFile() ? (fs.statSync(path.join(targetDir, e.name)).size) : null,
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ path: subPath || '.', files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/processes/:id/search', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });

  const resolvedCwd = resolveTemplate(config.cwd);
  const query = (req.query.q || '').trim();
  if (!query) return res.json({ results: [] });

  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '__pycache__', '.venv', 'vendor', 'coverage']);
  const MAX_RESULTS = 80;
  const MAX_FILE_SIZE = 512 * 1024; // skip files >512KB for content search
  const results = [];
  const queryLower = query.toLowerCase();

  function walk(dir, rel) {
    if (results.length >= MAX_RESULTS) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = rel ? rel + '/' + entry.name : entry.name;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath, relPath);
        continue;
      }

      // File name match
      if (entry.name.toLowerCase().includes(queryLower)) {
        results.push({ path: relPath, type: 'file' });
        continue;
      }

      // Content match — only text files under size limit
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_SIZE) continue;
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower)) {
            results.push({
              path: relPath,
              type: 'content',
              line: i + 1,
              text: lines[i].trim().substring(0, 200),
            });
            break; // one match per file
          }
        }
      } catch { /* binary or unreadable — skip */ }
    }
  }

  walk(resolvedCwd, '');
  res.json({ results });
});

app.get('/api/processes/:id/file', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });

  const resolvedCwd = resolveTemplate(config.cwd);
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  const fullPath = path.resolve(resolvedCwd, filePath);
  if (!fullPath.startsWith(resolvedCwd)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large (>2MB)' });
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/processes/:id/file-raw', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });

  const resolvedCwd = resolveTemplate(config.cwd);
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  const fullPath = path.resolve(resolvedCwd, filePath);
  if (!fullPath.startsWith(resolvedCwd)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) res.status(err.statusCode || 500).json({ error: err.message });
  });
});

app.put('/api/processes/:id/file', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });

  const resolvedCwd = resolveTemplate(config.cwd);
  const filePath = req.body.path;
  const content = req.body.content;
  const encoding = req.body.encoding || 'utf-8';
  
  if (!filePath || content == null) return res.status(400).json({ error: 'path and content are required' });

  const fullPath = path.resolve(resolvedCwd, filePath);
  if (!fullPath.startsWith(resolvedCwd)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    fs.writeFileSync(fullPath, content, encoding);
    res.json({ ok: true, fullPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/processes/:id/file', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });

  const resolvedCwd = resolveTemplate(config.cwd);
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : (req.body?.path ? [req.body.path] : []);
  if (!paths.length) return res.status(400).json({ error: 'path or paths is required' });

  const deleted = [];
  const errors = [];

  for (const p of paths) {
    const fullPath = path.resolve(resolvedCwd, p);
    if (!fullPath.startsWith(resolvedCwd) || fullPath === resolvedCwd) {
      errors.push({ path: p, error: 'Access denied' });
      continue;
    }
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      deleted.push(p);
    } catch (err) {
      errors.push({ path: p, error: err.message });
    }
  }

  if (errors.length && !deleted.length) {
    return res.status(500).json({ error: errors[0].error, errors });
  }
  res.json({ ok: true, deleted, errors });
});

app.post('/api/processes/:id/file-path', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });

  const resolvedCwd = resolveTemplate(config.cwd);
  const filePath = req.body.path;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  const fullPath = path.resolve(resolvedCwd, filePath);
  res.json({ fullPath });
});

// Drop-target for browser drags where the real path isn't exposed. Client
// uploads the bytes; we persist to <node-cwd>/tmp/<basename> (overwriting
// any previous drop with the same name) and return the absolute path the
// caller can paste into a terminal.
function sanitizeBasename(name) {
  if (!name) return 'unnamed';
  // Strip path separators and control chars.
  let safe = String(name).replace(/[\x00-\x1f]/g, '').replace(/[\\/]/g, '_').trim();
  if (!safe || safe === '.' || safe === '..') safe = 'unnamed';
  return safe.slice(0, 255);
}
app.post('/api/processes/:id/upload-tmp',
  express.raw({ type: 'application/octet-stream', limit: '200mb' }),
  (req, res) => {
    const id = req.params.id;
    const config = processConfigs.find((c) => c.guid === id);
    if (!config) return res.status(404).json({ error: `Unknown process identifier: ${id}` });
    if (!config.cwd) return res.status(400).json({ error: 'Node has no cwd' });

    const rawName = req.get('X-Filename');
    if (!rawName) return res.status(400).json({ error: 'Missing X-Filename header' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Empty body — expected application/octet-stream' });
    }

    try {
      const resolvedCwd = resolveTemplate(config.cwd);
      const dropDir = path.join(resolvedCwd, 'tmp');
      fs.mkdirSync(dropDir, { recursive: true });
      const basename = sanitizeBasename(decodeURIComponent(rawName));
      const fullPath = path.join(dropDir, basename);
      fs.writeFileSync(fullPath, req.body);
      res.json({ fullPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

app.post('/api/processes/:id/ai-command', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });

  const resolvedCwd = resolveTemplate(config.cwd);
  const { prompt, files, tool } = req.body;
  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: 'files array is required' });
  }

  let combinedContext = prompt ? `Prompt:\n${prompt}\n\nContext files:\n\n` : "Context files:\n\n";

  for (const file of files) {
    const fullPath = path.resolve(resolvedCwd, file);
    if (!fullPath.startsWith(resolvedCwd)) {
      return res.status(403).json({ error: `Access denied for file ${file}` });
    }
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      combinedContext += `--- FILE: ${file} ---\n${content}\n\n`;
    } catch (err) {
      combinedContext += `--- FILE: ${file} ---\n(Failed to read: ${err.message})\n\n`;
    }
  }

  const executable = tool === 'claude' ? 'claude' : 'gemini'; 
  
  const proc = spawn(executable, [], {
    cwd: resolvedCwd,
    env: process.env
  });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  proc.stdout.on('data', (data) => res.write(data));
  proc.stderr.on('data', (data) => res.write(`[STDERR] ${data}`));
  
  proc.on('close', (code) => {
    res.end();
  });
  
  proc.on('error', (err) => {
    res.write(`\n[Error starting CLI: ${err.message}]\nEnsure '${executable}' is installed and in your PATH.`);
    res.end();
  });

  // Pass the generated context to the CLI via stdin
  proc.stdin.write(combinedContext);
  proc.stdin.end();
});

app.get('/api/processes/:id/git/branches', async (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });
  
  const resolvedCwd = resolveTemplate(config.cwd);
  try {
    const output = execFileSync('git', ['branch', '--format=%(refname:short)'], {
      cwd: resolvedCwd,
      encoding: 'utf-8',
      timeout: 5000
    });
    const branches = output.trim().split('\n').filter(Boolean);
    res.json({
      branches,
      current: getGitBranch(resolvedCwd)
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to list branches: ${err.message}` });
  }
});

app.post('/api/processes/:id/git/checkout', async (req, res) => {
  const id = req.params.id;
  const { branch, strategy } = req.body;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });
  if (!branch) return res.status(400).json({ error: 'Branch name is required' });

  const resolvedCwd = resolveTemplate(config.cwd);
  try {
    if (strategy === 'stash') {
      execFileSync('git', ['stash'], { cwd: resolvedCwd, encoding: 'utf-8', timeout: 10000 });
    } else if (strategy === 'discard') {
      execFileSync('git', ['reset', '--hard'], { cwd: resolvedCwd, encoding: 'utf-8', timeout: 10000 });
      execFileSync('git', ['clean', '-fd'], { cwd: resolvedCwd, encoding: 'utf-8', timeout: 10000 });
    }

    try {
      execFileSync('git', ['checkout', branch], {
        cwd: resolvedCwd,
        encoding: 'utf-8',
        timeout: 10000
      });
    } catch (err) {
      const stderr = err.stderr || err.message || '';
      if (stderr.includes("did not match any file(s) known to git")) {
        // Fallback: Try creating the branch
        execFileSync('git', ['checkout', '-b', branch], {
          cwd: resolvedCwd,
          encoding: 'utf-8',
          timeout: 10000
        });
      } else {
        throw err;
      }
    }

    // Always fetch after checkout to ensure UI has latest remote status
    try {
      execFileSync('git', ['fetch'], {
        cwd: resolvedCwd,
        encoding: 'utf-8',
        timeout: 10000
      });
    } catch (fetchErr) {
      console.error(`Fetch failed after checkout for ${id}:`, fetchErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    const msg = err.stderr || err.message;
    if (msg.includes('local changes to the following files would be overwritten')) {
      return res.status(409).json({ error: 'CONFLICT', message: msg });
    }
    res.status(500).json({ error: `Git checkout failed: ${msg}` });
  }
});

app.get('/api/processes/:id/git/status', async (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });

  const resolvedCwd = resolveTemplate(config.cwd);
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd: resolvedCwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = output.split('\n').filter(Boolean).map((line) => {
      const x = line[0];
      const y = line[1];
      const rest = line.slice(3);
      const path = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest;
      let state;
      if (x === '?' && y === '?') state = 'untracked';
      else if (x === '!' && y === '!') state = 'ignored';
      else if (x !== ' ' && y !== ' ') state = 'staged+unstaged';
      else if (x !== ' ') state = 'staged';
      else state = 'unstaged';
      return { path, state, x, y };
    });
    res.json({ count: files.length, files });
  } catch (err) {
    res.status(500).json({ error: `Failed to read git status: ${err.message}` });
  }
});

app.post('/api/processes/:id/git/remote-status', async (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });
  
  const resolvedCwd = resolveTemplate(config.cwd);
  try {
    // 1. Fetch
    try {
      execFileSync('git', ['fetch'], { cwd: resolvedCwd, timeout: 15000 });
    } catch (e) {
      // If fetch fails (no remote, network issues), we still try to compare with existing tracking info
    }
    
    // 2. Compare
    const local = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolvedCwd, encoding: 'utf-8' }).trim();
    let remote;
    try {
      remote = execFileSync('git', ['rev-parse', '@{u}'], { cwd: resolvedCwd, encoding: 'utf-8' }).trim();
    } catch {
      return res.json({ status: 'no-remote' });
    }
    
    if (local === remote) {
      return res.json({ status: 'up-to-date' });
    }
    
    const base = execFileSync('git', ['merge-base', 'HEAD', '@{u}'], { cwd: resolvedCwd, encoding: 'utf-8' }).trim();
    
    if (local === base) {
      return res.json({ status: 'behind' });
    } else if (remote === base) {
      return res.json({ status: 'ahead' });
    } else {
      return res.json({ status: 'diverged' });
    }
  } catch (err) {
    res.status(500).json({ error: `Git status check failed: ${err.message}` });
  }
});

app.post('/api/processes/:id/git/pull', async (req, res) => {
  const id = req.params.id;
  const { strategy } = req.body || {};
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });
  
  const resolvedCwd = resolveTemplate(config.cwd);
  try {
    if (strategy === 'stash') {
      execFileSync('git', ['stash'], { cwd: resolvedCwd, encoding: 'utf-8', timeout: 10000 });
    } else if (strategy === 'discard') {
      execFileSync('git', ['reset', '--hard'], { cwd: resolvedCwd, encoding: 'utf-8', timeout: 10000 });
      execFileSync('git', ['clean', '-fd'], { cwd: resolvedCwd, encoding: 'utf-8', timeout: 10000 });
    }

    execFileSync('git', ['pull'], { cwd: resolvedCwd, timeout: 30000 });
    res.json({ ok: true });
  } catch (err) {
    const msg = err.stderr || err.message;
    if (msg.includes('local changes to the following files would be overwritten')) {
      return res.status(409).json({ error: 'CONFLICT', message: msg });
    }
    res.status(500).json({ error: `Git pull failed: ${msg}` });
  }
});

app.post('/api/processes/:id/git/push', async (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config || !config.cwd) return res.status(404).json({ error: 'Process or CWD not found' });
  
  const resolvedCwd = resolveTemplate(config.cwd);
  try {
    execFileSync('git', ['push'], { cwd: resolvedCwd, timeout: 30000 });
    res.json({ ok: true });
  } catch (err) {
    const msg = err.stderr || err.message;
    res.status(500).json({ error: `Git push failed: ${msg}` });
  }
});

app.post('/api/browse-directory', (req, res) => {
  const startDir = req.body.startDir || os.homedir();
  const platform = os.platform();
  let cmd, args;

  if (platform === 'darwin') {
    const script = `
      set defaultDir to POSIX file "${startDir.replace(/"/g, '\\"')}"
      try
        set chosenFolder to POSIX path of (choose folder with prompt "Select Working Directory" default location defaultDir)
        return chosenFolder
      on error
        return "__CANCELLED__"
      end try
    `;
    cmd = 'osascript';
    args = ['-e', script];
  } else if (platform === 'win32') {
    const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.SelectedPath = '${startDir.replace(/'/g, "''")}'; $f.Description = 'Select Working Directory'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '__CANCELLED__' }`;
    cmd = 'powershell';
    args = ['-NoProfile', '-Command', psScript];
  } else {
    // Linux: try zenity, fall back to kdialog
    cmd = 'zenity';
    args = ['--file-selection', '--directory', '--title=Select Working Directory', `--filename=${startDir}/`];
  }

  try {
    const result = execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout: 60000,
    }).trim();
    if (!result || result === '__CANCELLED__') {
      return res.json({ cancelled: true });
    }
    // Remove trailing slash unless it's the root
    const dir = result.length > 1 ? result.replace(/[/\\]$/, '') : result;
    res.json({ path: dir });
  } catch (err) {
    // zenity failed on Linux — try kdialog
    if (platform === 'linux') {
      try {
        const result = execFileSync('kdialog', ['--getexistingdirectory', startDir, '--title', 'Select Working Directory'], {
          encoding: 'utf-8',
          timeout: 60000,
        }).trim();
        if (result) return res.json({ path: result });
      } catch {}
    }
    res.json({ cancelled: true });
  }
});

app.post('/api/browse-file', (req, res) => {
  const startDir = req.body.startDir || os.homedir();
  const platform = os.platform();
  let cmd, args;

  if (platform === 'darwin') {
    const script = `
      set defaultDir to POSIX file "${startDir.replace(/"/g, '\\"')}"
      try
        set chosenFile to POSIX path of (choose file with prompt "Select File" default location defaultDir)
        return chosenFile
      on error
        return "__CANCELLED__"
      end try
    `;
    cmd = 'osascript';
    args = ['-e', script];
  } else if (platform === 'win32') {
    const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.InitialDirectory = '${startDir.replace(/'/g, "''")}'; $f.Title = 'Select File'; if ($f.ShowDialog() -eq 'OK') { $f.FileName } else { '__CANCELLED__' }`;
    cmd = 'powershell';
    args = ['-NoProfile', '-Command', psScript];
  } else {
    cmd = 'zenity';
    args = ['--file-selection', '--title=Select File', `--filename=${startDir}/`];
  }

  try {
    const result = execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout: 60000,
    }).trim();
    if (!result || result === '__CANCELLED__') {
      return res.json({ cancelled: true });
    }
    res.json({ path: result });
  } catch (err) {
    if (platform === 'linux') {
      try {
        const result = execFileSync('kdialog', ['--getopenfilename', startDir, '--title', 'Select File'], {
          encoding: 'utf-8',
          timeout: 60000,
        }).trim();
        if (result) return res.json({ path: result });
      } catch {}
    }
    res.json({ cancelled: true });
  }
});

app.post('/api/browse-folder', (req, res) => {
  const startDir = req.body.startDir || os.homedir();
  const platform = os.platform();
  let cmd, args;

  if (platform === 'darwin') {
    const script = `
      set defaultDir to POSIX file "${startDir.replace(/"/g, '\\"')}"
      try
        set chosenDir to POSIX path of (choose folder with prompt "Select Folder" default location defaultDir)
        return chosenDir
      on error
        return "__CANCELLED__"
      end try
    `;
    cmd = 'osascript';
    args = ['-e', script];
  } else if (platform === 'win32') {
    const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.SelectedPath = '${startDir.replace(/'/g, "''")}'; $f.Description = 'Select Folder'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '__CANCELLED__' }`;
    cmd = 'powershell';
    args = ['-NoProfile', '-Command', psScript];
  } else {
    cmd = 'zenity';
    args = ['--file-selection', '--directory', '--title=Select Folder', `--filename=${startDir}/`];
  }

  try {
    const result = execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout: 60000,
    }).trim();
    if (!result || result === '__CANCELLED__') {
      return res.json({ cancelled: true });
    }
    res.json({ path: result });
  } catch (err) {
    if (platform === 'linux') {
      try {
        const result = execFileSync('kdialog', ['--getexistingdirectory', startDir, '--title', 'Select Folder'], {
          encoding: 'utf-8',
          timeout: 60000,
        }).trim();
        if (result) return res.json({ path: result });
      } catch {}
    }
    res.json({ cancelled: true });
  }
});

// ── Generic control dispatcher ──────────────
// One endpoint, action-keyed. Address cards by `name` or `guid`.
//   POST /api/control { "action": "card.start", "card": "web" }
//   POST /api/control { "action": "ui.notify", "message": "Build done", "type": "success" }
const CONTROL_ACTIONS = {
  'card.start': {
    description: 'Start a card by name or guid',
    params: { card: 'name or guid (required)', resumeId: 'optional session id' },
    run: ({ card, resumeId }) => {
      const cfg = findCard(card);
      if (!cfg) return { status: 404, body: { error: `card not found: ${card}` } };
      return { body: startProcess(cfg.guid, resumeId || null) };
    },
  },
  'card.stop': {
    description: 'Stop a card by name or guid',
    params: { card: 'name or guid (required)' },
    run: ({ card }) => {
      const cfg = findCard(card);
      if (!cfg) return { status: 404, body: { error: `card not found: ${card}` } };
      return { body: stopProcess(cfg.guid) };
    },
  },
  'card.restart': {
    description: 'Restart a card by name or guid',
    params: { card: 'name or guid (required)' },
    run: async ({ card }) => {
      const cfg = findCard(card);
      if (!cfg) return { status: 404, body: { error: `card not found: ${card}` } };
      const entry = processes.get(cfg.guid);
      if (entry && entry.status === 'running') {
        stopProcess(cfg.guid);
        await new Promise((resolve) => {
          const check = setInterval(() => {
            const s = getState(cfg.guid);
            if (s.status !== 'running' && s.status !== 'stopping') {
              clearInterval(check); resolve();
            }
          }, 200);
          setTimeout(() => { clearInterval(check); resolve(); }, 10000);
        });
      }
      return { body: startProcess(cfg.guid) };
    },
  },
  'card.input': {
    description: 'Send input (followed by Return) to a running card',
    params: { card: 'name or guid (required)', input: 'string to send (required)' },
    run: ({ card, input }) => {
      if (typeof input !== 'string') {
        return { status: 400, body: { error: 'input (string) is required' } };
      }
      const cfg = findCard(card);
      if (!cfg) return { status: 404, body: { error: `card not found: ${card}` } };
      const entry = processes.get(cfg.guid);
      if (!entry || entry.status !== 'running') {
        return { status: 400, body: { error: `${cfg.name} is not running` } };
      }
      entry.needsInput = false;
      if (entry.ptyProc) {
        entry.ptyProc.write(input + '\r');
      } else if (entry.proc && entry.proc.stdin && !entry.proc.stdin.destroyed) {
        entry.proc.stdin.write(input + '\r');
      } else {
        return { status: 400, body: { error: `${cfg.name} stdin is not available` } };
      }
      appendLog(entry, 'stdin', input);
      return { body: { ok: true } };
    },
  },
  'card.startGroup': {
    description: 'Start every card in a group',
    params: { group: 'group name (required)' },
    run: ({ group }) => {
      const matches = processConfigs.filter(c => c.group === group);
      if (matches.length === 0) return { status: 404, body: { error: `no cards in group: ${group}` } };
      const results = {};
      for (const c of matches) results[c.name] = startProcess(c.guid);
      return { body: { group, count: matches.length, results } };
    },
  },
  'card.stopGroup': {
    description: 'Stop every card in a group',
    params: { group: 'group name (required)' },
    run: ({ group }) => {
      const matches = processConfigs.filter(c => c.group === group);
      if (matches.length === 0) return { status: 404, body: { error: `no cards in group: ${group}` } };
      const results = {};
      for (const c of matches) results[c.name] = stopProcess(c.guid);
      return { body: { group, count: matches.length, results } };
    },
  },
  'ui.notify': {
    description: 'Broadcast a toast notification to all connected UI clients',
    params: {
      message: 'string (required)',
      type: 'success | error | info | warning (default: info)',
      duration: 'ms (default: 3000, 0 = sticky)',
    },
    run: ({ message, type, duration }) => {
      if (!message || typeof message !== 'string') {
        return { status: 400, body: { error: 'message (string) is required' } };
      }
      const validTypes = new Set(['success', 'error', 'info', 'warning']);
      const t = validTypes.has(type) ? type : 'info';
      const d = Number.isFinite(duration) ? duration : 3000;
      broadcastUi({ kind: 'notify', message, type: t, duration: d });
      return { body: { ok: true, delivered: uiClients.size } };
    },
  },
  'ui.focus': {
    description: 'Focus a card in the UI (selects it and opens its log panel)',
    params: { card: 'name or guid (required)' },
    run: ({ card }) => {
      const cfg = findCard(card);
      if (!cfg) return { status: 404, body: { error: `card not found: ${card}` } };
      broadcastUi({ kind: 'focus', guid: cfg.guid, name: cfg.name });
      return { body: { ok: true, delivered: uiClients.size } };
    },
  },
};

app.get('/api/control', (_req, res) => {
  const actions = {};
  for (const [name, def] of Object.entries(CONTROL_ACTIONS)) {
    actions[name] = { description: def.description, params: def.params };
  }
  res.json({ endpoint: 'POST /api/control', body: '{ "action": "<name>", ...params }', actions });
});

app.post('/api/control', async (req, res) => {
  const { action, ...params } = req.body || {};
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'action (string) is required' });
  }
  const def = CONTROL_ACTIONS[action];
  if (!def) {
    return res.status(404).json({
      error: `unknown action: ${action}`,
      hint: 'GET /api/control for the action catalog',
    });
  }
  try {
    const out = await def.run(params);
    res.status(out.status || 200).json(out.body);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/start-all', (_req, res) => {
  const results = {};
  for (const config of processConfigs) {
    results[config.guid] = startProcess(config.guid);
  }
  res.json(results);
});

app.post('/api/stop-all', (_req, res) => {
  const results = {};
  for (const config of processConfigs) {
    results[config.guid] = stopProcess(config.guid);
  }
  res.json(results);
});

app.post('/api/config/import', (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Body must be a JSON array of process configs' });
  }
  const added = [];
  const skipped = [];
  for (const item of items) {
    if (!item.name || !item.command) {
      skipped.push({ name: item.name || '(unnamed)', reason: 'missing name or command' });
      continue;
    }
    const entry = { 
      guid: item.guid || generateGuid(),
      name: item.name, 
      command: item.command, 
      args: item.args || [], 
      type: item.type || 'service', 
      group: item.group || 'other' 
    };
    if (item.cwd) entry.cwd = item.cwd;
    if (item.stopCommand) entry.stopCommand = item.stopCommand;
    if (item.usePty !== undefined) entry.usePty = !!item.usePty;
    const onSuccessNormalized = normalizeOnSuccess(item.onSuccess);
    if (onSuccessNormalized !== undefined) entry.onSuccess = onSuccessNormalized;
    processConfigs.push(entry);
    added.push(item.name);
  }
  if (added.length > 0) saveConfig();
  res.json({ added, skipped });
});

app.post('/api/config', (req, res) => {
  const { name, command, args, argsMode, cwd, type, group, stopCommand, usePty, onSuccess, tools } = req.body;
  if (!name || !command) {
    return res.status(400).json({ error: 'name and command are required' });
  }
  const entry = { guid: generateGuid(), name, command, args: args || [], argsMode: argsMode || 'raw', type: type || 'service', group: group || 'other' };
  if (cwd) entry.cwd = cwd;
  if (stopCommand) entry.stopCommand = stopCommand;
  if (usePty !== undefined) entry.usePty = !!usePty;
  const onSuccessNormalized = normalizeOnSuccess(onSuccess);
  if (onSuccessNormalized !== undefined) entry.onSuccess = onSuccessNormalized;
  if (Array.isArray(tools)) entry.tools = tools;
  processConfigs.push(entry);  saveConfig();
  res.json({ ok: true });
});

app.get('/api/config/:id', (req, res) => {
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config) {
    return res.status(404).json({ error: `Process "${id}" not found` });
  }
  res.json(config);
});

app.put('/api/config/:id', (req, res) => {
  const id = req.params.id;
  const idx = processConfigs.findIndex((c) => c.guid === id);
  if (idx === -1) {
    return res.status(404).json({ error: `Process "${id}" not found` });
  }
  const existing = processConfigs[idx];
  const { name: newName, command, args, argsMode, cwd, type, group, stopCommand, usePty, onSuccess, tools } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'command is required' });
  }
  const finalName = (newName && newName.trim()) ? newName.trim() : existing.name;
  const updated = { 
    guid: existing.guid || generateGuid(),
    name: finalName, 
    command, 
    args: args || [], 
    argsMode: argsMode || 'raw', 
    type: type || 'service', 
    group: group || 'other' 
  };
  if (cwd) updated.cwd = cwd;
  if (stopCommand) updated.stopCommand = stopCommand;
  if (usePty !== undefined) updated.usePty = !!usePty;
  const onSuccessNormalized = normalizeOnSuccess(onSuccess);
  if (onSuccessNormalized !== undefined) updated.onSuccess = onSuccessNormalized;
  if (Array.isArray(tools)) updated.tools = tools;
  
  const oldGuid = existing.guid;
  processConfigs[idx] = updated;
  saveConfig();

  if (updated.guid !== oldGuid) {
    const entry = processes.get(oldGuid);
    if (entry) {
      processes.delete(oldGuid);
      processes.set(updated.guid, entry);
    }
  }

  res.json({ ok: true });
});

app.delete('/api/config/:id', (req, res) => {
  const id = req.params.id;
  const idx = processConfigs.findIndex((c) => c.guid === id);
  if (idx === -1) {
    return res.status(404).json({ error: `Process "${id}" not found` });
  }
  const config = processConfigs[idx];
  const guid = config.guid;
  const running = processes.get(guid);
  if (running && running.status === 'running') {
    stopProcess(guid);
  }
  for (const [chatId, entry] of processes.entries()) {
    if (entry.parentGuid === guid) killChat(chatId);
  }
  processConfigs.splice(idx, 1);
  processes.delete(guid);
  saveConfig();
  res.json({ ok: true });
});

app.get('/api/env', (_req, res) => {
  res.json(envVars);
});

app.put('/api/env', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be a JSON object of key-value pairs' });
  }
  envVars = body;
  saveEnvConfig();
  res.json({ ok: true });
});

app.put('/api/system', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be a JSON object' });
  }
  const allowed = ['port', 'maxLogLines', 'terminalWidth', 'logPollInterval', 'statusPollInterval', 'popoverPollInterval'];
  for (const key of allowed) {
    if (body[key] !== undefined) systemConfig[key] = body[key];
  }
  fs.writeFileSync(systemConfigPath, JSON.stringify(systemConfig, null, 2) + '\n');
  res.json({ ok: true, note: 'Restart server for port/maxLogLines changes to take effect' });
});

app.get('/api/groups', (_req, res) => {
  res.json(groupList);
});

app.put('/api/groups', (req, res) => {
  const body = req.body;
  if (!Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be a JSON array of { name, color } objects' });
  }
  const seen = new Set();
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const raw = body[i];
    let name;
    let color;
    if (typeof raw === 'string') {
      name = raw.trim();
      color = DEFAULT_PALETTE[out.length % DEFAULT_PALETTE.length];
    } else if (raw && typeof raw === 'object') {
      name = String(raw.name ?? '').trim();
      color = String(raw.color ?? '').trim();
      if (!isValidHexColor(color)) {
        return res.status(400).json({ error: `Invalid color for group "${name || '(unnamed)'}" (use #RGB or #RRGGBB)` });
      }
      color = color.toLowerCase();
      if (color.length === 4) {
        color = `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
      }
    } else {
      continue;
    }
    if (!name) continue;
    if (seen.has(name)) {
      return res.status(400).json({ error: `Duplicate group name: "${name}"` });
    }
    seen.add(name);
    out.push({ name, color });
  }
  if (out.length === 0) {
    return res.status(400).json({ error: 'At least one group is required' });
  }
  groupList = out;
  saveGroupsConfig();
  res.json({ ok: true });
});

app.get('/api/tools', (_req, res) => {
  res.json(toolsList);
});

app.post('/api/processes/:id/tools/execute', (req, res) => {
  const { toolLabel, param, params } = req.body;
  const id = req.params.id;
  const config = processConfigs.find((c) => c.guid === id);
  if (!config) return res.status(404).json({ error: 'Process not found' });

  const tool = toolsList.find(t => t.label === toolLabel);
  if (!tool) return res.status(404).json({ error: 'Tool not found' });

  const resolvedCwd = resolveTemplate(config.cwd) || process.cwd();
  let cmd = tool.path;

  // Support {cwd} in tool path
  if (cmd.includes('{cwd}')) {
    cmd = cmd.split('{cwd}').join(resolvedCwd);
  }
  
  // Quote path if it contains spaces and isn't already quoted
  if (cmd.includes(' ') && !cmd.startsWith('"') && !cmd.startsWith("'")) {
    // If it's a simple path (no spaces except in the path itself, and exists as a file)
    // or if it's an absolute path that likely needs quoting.
    const toolExecPath = path.isAbsolute(cmd) ? cmd : path.resolve(resolvedCwd, cmd);
    if (fs.existsSync(toolExecPath) || (path.isAbsolute(cmd) && cmd.includes(' '))) {
      cmd = `"${cmd}"`;
    }
  }

  // Handle multiple params
  if (Array.isArray(params)) {
    let replacedAny = false;
    params.forEach((p, i) => {
      const placeholder = `{param${i}}`;
      if (cmd.includes(placeholder)) {
        cmd = cmd.split(placeholder).join(p || '');
        replacedAny = true;
      }
    });
    
    if (!replacedAny) {
      params.forEach(p => {
        if (p) {
          const quotedP = (p.includes(' ') && !p.startsWith('"') && !p.startsWith("'")) ? `"${p}"` : p;
          cmd += ` ${quotedP}`;
        }
      });
    }
  } else if (cmd.includes('{param}')) {
    const quotedParam = (param && param.includes(' ') && !param.startsWith('"') && !param.startsWith("'")) ? `"${param}"` : (param || '');
    cmd = cmd.replace('{param}', quotedParam);
  } else if (param) {
    const quotedParam = (param.includes(' ') && !param.startsWith('"') && !param.startsWith("'")) ? `"${param}"` : param;
    cmd += ` ${quotedParam}`;
  }

  console.log(`[xpm] Executing tool: ${cmd} in ${resolvedCwd}`);

  exec(cmd, { cwd: resolvedCwd, env: getProcessEnv() }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[xpm] Tool failed: ${error.message}`);
      return res.json({ error: stderr || error.message });
    }
    res.json({ ok: true, output: stdout });
  });
});

app.put('/api/tools', (req, res) => {
  const body = req.body;
  if (!Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be a JSON array of tool objects' });
  }
  // Basic validation
  const validated = body.filter(t => t && typeof t === 'object' && t.label && t.path);
  toolsList = validated.map(t => ({
    label: String(t.label).trim(),
    path: String(t.path).trim(),
    isBuiltIn: !!t.isBuiltIn,
    requireConfirmation: !!t.requireConfirmation,
    params: Array.isArray(t.params) ? t.params.map(p => ({
      label: String(p.label).trim(),
      type: ['text', 'file', 'folder'].includes(p.type) ? p.type : 'text'
    })) : []
  }));
  saveToolsConfig();
  res.json({ ok: true });
});

// ── Skills endpoints ────────────────────────────────────────────────────
app.get('/api/skills', (_req, res) => {
  res.json(listSkills());
});

// Bulk sync: client sends rows = [{ originalName, name, description }].
// Server reconciles disk: rename folders, rewrite frontmatter, delete
// any on-disk skills not present in the payload.
app.put('/api/skills', (req, res) => {
  const body = req.body;
  if (!Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be a JSON array of skill rows' });
  }
  const rows = [];
  const seenNames = new Set();
  for (const r of body) {
    if (!r || typeof r !== 'object') continue;
    const name = String(r.name || '').trim();
    if (!name) continue;
    if (!isValidSkillName(name)) {
      return res.status(400).json({ error: `Invalid skill name: "${name}"` });
    }
    if (seenNames.has(name)) {
      return res.status(400).json({ error: `Duplicate skill name: "${name}"` });
    }
    seenNames.add(name);
    rows.push({
      originalName: r.originalName ? String(r.originalName) : null,
      name,
      description: String(r.description || '').trim(),
    });
  }

  fs.mkdirSync(skillsDir, { recursive: true });

  // Apply renames first so the on-disk set matches the new names
  for (const row of rows) {
    if (row.originalName && row.originalName !== row.name) {
      const ok = renameSkill(row.originalName, row.name);
      if (!ok && fs.existsSync(path.join(skillsDir, row.originalName))) {
        return res.status(400).json({ error: `Cannot rename "${row.originalName}" to "${row.name}"` });
      }
    }
  }

  // Delete on-disk skills not in payload
  const keep = new Set(rows.map(r => r.name));
  for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (e.isDirectory() && !keep.has(e.name)) {
      deleteSkill(e.name);
    }
  }

  // Write/refresh frontmatter for each remaining skill
  for (const row of rows) {
    writeSkillFile(row.name, row.description, undefined);
  }

  res.json({ ok: true });
});

// Upload a single SKILL.md file. Body: { name?, content }. The skill name
// is taken from explicit `name` param, else parsed from frontmatter, else
// rejected. Companion files (references/, scripts/) must be added on disk.
app.post('/api/skills/upload', (req, res) => {
  const { name: explicitName, content } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content (SKILL.md text) is required' });
  }
  const { meta, body } = parseSkillFrontmatter(content);
  const name = String(explicitName || meta.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Skill name missing (no `name` arg and no frontmatter `name:`)' });
  }
  if (!isValidSkillName(name)) {
    return res.status(400).json({ error: `Invalid skill name: "${name}"` });
  }
  fs.mkdirSync(skillsDir, { recursive: true });
  const dir = path.join(skillsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    serializeSkillFile({ name, description: meta.description || '' }, body),
  );
  res.json({ ok: true, name, description: meta.description || '' });
});

async function bootstrap() {
  if (process.env.NODE_ENV === 'development') {
    const { createServer } = require('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    // Serve index.html with Vite's HMR transformation
    app.get('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api') || url.startsWith('/ws')) return next();
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    app.use(express.static(fs.existsSync(distDir) ? distDir : publicDir));
    app.get('*', (req, res) => {
      res.sendFile(path.join(fs.existsSync(distDir) ? distDir : publicDir, 'index.html'));
    });
  }

  // ── HTTP + WebSocket Server ─────────────────
  const server = http.createServer(app);
  // Use noServer mode and dispatch by path manually. With multiple
  // WebSocketServer instances bound to the same http.Server via { server, path },
  // every WSS receives every upgrade event; the non-matching ones call
  // abortHandshake() which writes a raw HTTP 400 onto the socket that the
  // matching WSS has already upgraded — Chrome then reports "Invalid frame
  // header" on the first frame after the handshake.
  const wss = new WebSocketServer({ noServer: true });
  const uiWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname === '/ws/terminal') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else if (pathname === '/ws/ui') {
      uiWss.handleUpgrade(req, socket, head, (ws) => uiWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  uiWss.on('connection', (ws) => {
    uiClients.add(ws);
    ws.on('error', () => {});
    ws.on('close', () => { uiClients.delete(ws); });
  });

  wss.on('connection', (ws, req) => {
    // Extract process identifier from query: /ws/terminal?id=<idOrGuid>
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = url.searchParams.get('id') || url.searchParams.get('name'); // Fallback to name for legacy
    if (!id) { ws.close(1008, 'Missing id param'); return; }

    const config = processConfigs.find((c) => c.guid === id);
    const guid = config?.guid || id;

    const entry = processes.get(guid);
    if (!entry || (entry.status !== 'running' && !entry.logs.length)) { 
      ws.close(1008, 'Process not found or not running'); 
      return; 
    }

    // Register client
    if (!wsClients.has(guid)) wsClients.set(guid, new Set());
    wsClients.get(guid).add(ws);

    ws.on('error', () => {});  // Prevent unhandled error crashes

    // Replay raw output (PTY or non-PTY) so late-connecting terminals render faithfully
    const buffer = entry.config.usePty ? entry.ptyRawBuffer : entry.logRawBuffer;
    if (buffer && ws.readyState === 1) {
      try {
        ws.send(buffer);
      } catch {}
    }

    // Client → Process (keyboard input + resize)
    ws.on('message', (msg) => {
      const currentEntry = processes.get(guid);
      if (!currentEntry) return;

      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'resize') {
          if (currentEntry.ptyProc) {
            currentEntry.ptyProc.resize(
              Math.min(parsed.cols, 300),
              Math.min(parsed.rows, 100)
            );
          }
        } else if (parsed.type === 'input') {
          currentEntry.needsInput = false;
          if (currentEntry.ptyProc) {
            currentEntry.ptyProc.write(parsed.data);
          } else if (currentEntry.proc && currentEntry.proc.stdin && !currentEntry.proc.stdin.destroyed) {
            currentEntry.proc.stdin.write(parsed.data);
          }
        }
      } catch {
        const data = msg.toString();
        currentEntry.needsInput = false;
        if (currentEntry.ptyProc) {
          currentEntry.ptyProc.write(data);
        } else if (currentEntry.proc && currentEntry.proc.stdin && !currentEntry.proc.stdin.destroyed) {
          currentEntry.proc.stdin.write(data);
        }
      }
    });

    ws.on('close', () => {
      const set = wsClients.get(guid);
      if (set) { set.delete(ws); if (set.size === 0) wsClients.delete(guid); }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const k in interfaces) {
      for (const k2 in interfaces[k]) {
        const address = interfaces[k][k2];
        if (address.family === 'IPv4' && !address.internal) {
          addresses.push(address.address);
        }
      }
    }

    console.log(`Nexus running at:`);
    console.log(`  - Local:   http://localhost:${PORT}`);
    addresses.forEach(addr => {
      console.log(`  - Network: http://${addr}:${PORT}`);
    });
    console.log(`[${process.env.NODE_ENV || 'production'}]`);
  });
}

bootstrap().catch(err => {
  console.error('Failed to bootstrap server:', err);
});
