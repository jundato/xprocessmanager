// Helpers for inserting dropped file paths into a terminal.
//
// Real OS paths are sometimes available without copying the file (Electron
// exposes File.path; some sources populate text/uri-list with file://). When
// they aren't (browser drag from Finder), we upload the bytes to the server,
// which writes to a shared tmp dir and returns an absolute path.

// Try to read a real path directly from the DataTransfer. Returns paths
// found, plus the File objects we couldn't resolve (caller uploads those).
export function readDroppedPaths(ev) {
  const dt = ev.dataTransfer
  if (!dt) return { paths: [], unresolvedFiles: [] }

  const paths = []
  const uriList = dt.getData && dt.getData('text/uri-list')
  const plain = !uriList && dt.getData ? dt.getData('text/plain') : ''
  for (const raw of (uriList || plain || '').split(/\r?\n/)) {
    const line = raw && raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('file://')) {
      try { paths.push(decodeURIComponent(new URL(line).pathname)) } catch {}
    } else if (line.startsWith('/') || /^[A-Za-z]:\\/.test(line)) {
      paths.push(line)
    }
  }

  const unresolvedFiles = []
  const files = dt.files
  if (files && files.length > 0) {
    for (const f of files) {
      if (f.path && (f.path.startsWith('/') || /^[A-Za-z]:\\/.test(f.path))) {
        paths.push(f.path)        // Electron — no upload needed.
      } else if (paths.length === 0) {
        unresolvedFiles.push(f)   // Browser — caller will upload.
      }
    }
  }
  return { paths, unresolvedFiles }
}

// Upload a File to the server's tmp drop dir. Returns the absolute path the
// server wrote to.
export async function uploadDroppedFile(nodeGuid, file) {
  const buf = await file.arrayBuffer()
  const res = await fetch(
    `/api/processes/${encodeURIComponent(nodeGuid)}/upload-tmp`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
      },
      body: buf,
    }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.fullPath) {
    throw new Error(data.error || `Upload failed (${res.status})`)
  }
  return data.fullPath
}

// POSIX-safe shell quoting. Single-quote the path and escape embedded quotes.
export function shellQuote(p) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(p)) return p
  return `'${p.replace(/'/g, `'\\''`)}'`
}

// One-shot resolver: returns absolute paths for all items in the drop,
// uploading any files whose path the OS didn't expose.
export async function resolveDroppedPaths(ev, nodeGuid) {
  const { paths, unresolvedFiles } = readDroppedPaths(ev)
  if (unresolvedFiles.length === 0) return paths
  if (!nodeGuid) return paths
  const uploaded = []
  for (const f of unresolvedFiles) {
    try { uploaded.push(await uploadDroppedFile(nodeGuid, f)) }
    catch (err) { console.warn('[useFileDrop] upload failed', f.name, err) }
  }
  return [...paths, ...uploaded]
}
