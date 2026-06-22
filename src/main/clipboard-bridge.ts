import { mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CLIPBOARD_SAVE_FILES_CHANNEL } from '#/shared/ipc-channels.ts'
import { CLIPBOARD_TEMP_FILE_MAX_AGE_MS, PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'

/**
 * Wire on `webUtils.getPathForFile`. This is the only Electron preload /
 * main-process surface that resolves a `File` (delivered via the
 * `ClipboardEvent` / `DragEvent`) back to an absolute filesystem path —
 * the renderer uses it transparently through `pathForDroppedFile`.
 *
 * The main process only owns the *blob save* path: when a file has no
 * filesystem path (image copied from a browser tab, screenshot, etc.) the
 * renderer ships `{name, bytes}` over IPC and we persist it under a temp
 * dir so the PTY can read it as a real file.
 */
export interface BinaryClipboardFile {
  name: string
  bytes: ArrayBuffer
}

const TEMP_DIR_NAME = `goblin-clipboard-${process.pid}`
const WINDOWS_RESERVED_FILE_STEM_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function clipboardTempDir(): string {
  return path.join(os.tmpdir(), TEMP_DIR_NAME)
}

function avoidWindowsReservedBaseName(base: string): string {
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/\.+$/g, '')
  return WINDOWS_RESERVED_FILE_STEM_RE.test(stem) ? `_${base}` : base
}

function sanitizeBaseName(name: string): string {
  // `path.basename` strips path separators (defence in depth — the
  // preload should not be sending path-shaped input in the first
  // place). The regex replaces the Windows-reserved set plus ASCII
  // control characters; if nothing is left after that, fall back to
  // `clipboard.bin`. Note: this fallback is *not* the same as
  // `CLIPBOARD_FALLBACK_FILE_NAME` in shared/clipboard-paste.ts —
  // that one substitutes for an empty `File.name` at the multipart
  // boundary, while this one substitutes for a name whose
  // post-sanitisation residue is empty.
  const base = path
    .basename(name)
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/g, '_')
    .trim()
  return base.length > 0 ? avoidWindowsReservedBaseName(base) : 'clipboard.bin'
}

// Process-level monotonically increasing counter. The previous
// `${ISO-timestamp}-${index}` scheme collided when two single-file
// pastes landed in the same millisecond from the same paste event —
// the second `writeFile` silently overwrote the first. The counter
// (combined with the per-request index) is unique within the
// process lifetime.
let filenameCounter = 0
function timestampedFileName(index: number, name: string): string {
  // Format: <ISO>-<index>-<counter>-<name>. The counter is the
  // process-level increment; the index is the per-request array
  // position. Multi-file pastes still get index 0..N within a
  // single counter step, but two *different* paste events in the
  // same millisecond land at different counter values.
  filenameCounter += 1
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${timestamp}-${index}-${filenameCounter}-${sanitizeBaseName(name)}`
}

// Module-level handle to the periodic prune interval. `wireClipboardBridgeIpc`
// can be called more than once in the test harness (and could be in a
// future hot-reload), and `setInterval` itself has no idea about that —
// without this handle, each call would schedule an additional 1 h timer
// and the old ones would never be cleared. The IPC handler is
// overwritten by `ipcMain.handle`, so the *handler* leak is not an
// issue, but the *timer* leak is.
let periodicPrune: NodeJS.Timeout | null = null

/**
 * Persist clipboard / drop blobs to the per-process temp directory.
 *
 * Throws if any single payload exceeds `PASTE_FILE_MAX_BYTES`. The renderer
 * is supposed to short-circuit oversize files with a `paste-file-too-large`
 * toast *before* IPC; this guard is defence in depth for a misbehaving or
 * skipped preload.
 */
export async function saveClipboardBinaryFiles(files: BinaryClipboardFile[]): Promise<string[]> {
  if (files.length === 0) return []
  for (const file of files) {
    if (file.bytes.byteLength > PASTE_FILE_MAX_BYTES) {
      throw new Error(`Clipboard payload exceeds ${PASTE_FILE_MAX_BYTES} bytes`)
    }
  }
  const dir = clipboardTempDir()
  await mkdir(dir, { recursive: true })
  const written: string[] = []
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    const filePath = path.join(dir, timestampedFileName(i, file.name))
    await writeFile(filePath, Buffer.from(file.bytes))
    written.push(filePath)
  }
  return written
}

/**
 * Best-effort cleanup of clipboard temp dirs left by previous process runs.
 *
 * The current process's own dir uses `<TMPDIR>/goblin-clipboard-<pid>`; on
 * startup we sweep everything matching that prefix that is *not* ours and
 * delete it. If the OS later reuses our PID after a crash we'd skip a
 * cleanup, which is acceptable — the OS already manages `/tmp` reaping on
 * most platforms and the worst case is a tiny amount of left-over disk.
 */
export async function pruneStaleClipboardTempDirs(): Promise<void> {
  const tmp = os.tmpdir()
  let entries: string[]
  try {
    entries = await readdir(tmp)
  } catch {
    return
  }
  const selfDirName = TEMP_DIR_NAME
  for (const entry of entries) {
    if (!entry.startsWith('goblin-clipboard-') || entry === selfDirName) continue
    try {
      await rm(path.join(tmp, entry), { recursive: true, force: true })
    } catch {
      // Best effort — another process may be using it, or permissions deny.
      // Either way, leaving the dir is preferable to crashing startup.
    }
  }
}

export async function pruneExpiredClipboardTempFiles(
  now = Date.now(),
  maxAgeMs = CLIPBOARD_TEMP_FILE_MAX_AGE_MS,
): Promise<void> {
  // Electron stores pasted blobs under `os.tmpdir()`, so this is a
  // housekeeping cap for the current long-running process; stale
  // previous-process dirs are handled separately at startup.
  const dir = clipboardTempDir()
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const filePath = path.join(dir, entry)
    try {
      const info = await stat(filePath)
      if (!info.isFile()) continue
      if (now - info.mtimeMs <= maxAgeMs) continue
      await unlink(filePath)
    } catch {
      // Best effort — the file may have been removed between readdir
      // and stat/unlink, or permissions may deny deletion.
    }
  }
}

function asObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function coerceBinaryClipboardFiles(input: unknown): BinaryClipboardFile[] | null {
  if (!Array.isArray(input)) return null
  const out: BinaryClipboardFile[] = []
  for (const entry of input) {
    if (!asObject(entry)) return null
    const { name, bytes } = entry
    if (typeof name !== 'string' || !(bytes instanceof ArrayBuffer)) return null
    out.push({ name, bytes })
  }
  return out
}

export function wireClipboardBridgeIpc(): void {
  ipcMain.handle(CLIPBOARD_SAVE_FILES_CHANNEL, async (event, payload: unknown): Promise<string[]> => {
    if (!isTrustedIpcEvent(event)) return []
    const files = coerceBinaryClipboardFiles(payload)
    if (!files) return []
    try {
      return await saveClipboardBinaryFiles(files)
    } catch (err) {
      // We collapse to `[]` so the resolver can count a backend-transfer
      // failure, but the renderer can't tell *why*
      // this bridge call failed. Log here so ops can diagnose (an oversized
      // payload routed through a misbehaving preload, a temp-dir
      // permission failure, etc.). Uses raw console.warn because
      // pino/consola isn't available in this module's import graph;
      // the renderer-side `web/logger.ts` will already be emitting
      // its own record of the toast.
      console.warn(`[clipboard-bridge] ${CLIPBOARD_SAVE_FILES_CHANNEL} failed`, err)
      return []
    }
  })
  // Startup prune removes leftovers from previous PIDs. Periodic
  // prune handles the long-running main process: the temp dir at
  // `<os.tmpdir>/goblin-clipboard-<pid>/` only grows on writes
  // (no per-write cleanup), so a 24/7 desktop install that pastes
  // files hundreds of times a day would otherwise accumulate
  // forever. The cadence is deliberately coarse (1 h) — the cap
  // is bounded by per-file size, not file count, so this is a
  // housekeeping measure, not a security control.
  void pruneStaleClipboardTempDirs()
  void pruneExpiredClipboardTempFiles()
  // Clear any previous interval — `wireClipboardBridgeIpc` may be
  // re-entered (test harness, future hot-reload), and `setInterval`
  // itself doesn't know about re-entry. Without this guard each call
  // would stack another timer that no one ever clears.
  if (periodicPrune !== null) {
    clearInterval(periodicPrune)
    periodicPrune = null
  }
  periodicPrune = setInterval(
    () => {
      void Promise.all([pruneStaleClipboardTempDirs(), pruneExpiredClipboardTempFiles()]).catch((err) =>
        console.warn('[clipboard-bridge] periodic prune failed', err),
      )
    },
    60 * 60 * 1000,
  )
  // Allow the process to exit naturally even with the timer
  // attached — without this, the interval keeps the event loop
  // alive indefinitely.
  if (typeof periodicPrune.unref === 'function') periodicPrune.unref()
}

// resolveOsClipboardPath was added during the design phase as a
// forward-looking helper for a future "single-source the path-attempt
// contract" refactor, but nothing ever imported it. The renderer's
// `pathForDroppedFile` calls `webUtils.getPathForFile` directly through
// the preload, and pulling that into main buys nothing — `File` doesn't
// survive the contextBridge boundary, so the call has to live in the
// preload anyway. Removed.
