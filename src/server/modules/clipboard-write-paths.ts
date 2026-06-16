import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { serverDataDir } from '#/server/common/data-dir.ts'
import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'

/**
 * Web counterpart to `src/main/clipboard-bridge.ts`. Web renderers reach
 * the server over HTTP via `POST /api/clipboard/files`; the route layer
 * normalises the multipart body and hands a `File[]` to this module.
 *
 * Server-written paths live on the *server* machine. In `serve.sh` /
 * LAN deployments the renderer and server may be on different hosts —
 * the PTY (which lives on the server) can still read these paths, but
 * the user cannot double-click them on their own machine. That tradeoff
 * is acknowledged in the design doc.
 */

const TEMP_DIR_NAME = `clipboard-tmp-${process.pid}`

export function clipboardTempDir(): string {
  return path.join(serverDataDir(), TEMP_DIR_NAME)
}

function sanitizeBaseName(name: string): string {
  // Strip path separators (defence in depth — `path.basename` should already
  // have removed them) and a small set of Windows-reserved characters. The
  // dash inside the class is escaped so it stays a literal, not a range.
  const base = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  return base.length > 0 ? base : 'clipboard.bin'
}

function timestampedFileName(index: number, name: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${timestamp}-${index}-${sanitizeBaseName(name)}`
}

export interface SaveClipboardFilesResult {
  /** Absolute paths the PTY can read. */
  paths: string[]
}

/**
 * Persist `File` instances received from the multipart body to the
 * per-process temp directory.
 *
 * Throws if any single file exceeds `PASTE_FILE_MAX_BYTES` — the route
 * layer maps this to a 413. The bodyLimit middleware bounds the *batch*,
 * so a single oversized file still surfaces here only when the renderer
 * is bypassed (a misbehaving client) or when the per-file check in the
 * renderer was skipped.
 */
export async function saveClipboardFiles(files: File[]): Promise<SaveClipboardFilesResult> {
  if (files.length === 0) return { paths: [] }
  for (const file of files) {
    if (file.size > PASTE_FILE_MAX_BYTES) {
      throw new Error(`Clipboard payload exceeds ${PASTE_FILE_MAX_BYTES} bytes`)
    }
  }
  const dir = clipboardTempDir()
  await mkdir(dir, { recursive: true })
  const written: string[] = []
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    const filePath = path.join(dir, timestampedFileName(i, file.name))
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(filePath, buffer)
    written.push(filePath)
  }
  return { paths: written }
}

/**
 * Best-effort sweep of clipboard temp dirs from previous server runs.
 * Called once when the route module is constructed. Idempotent; safe to
 * call multiple times if a hot-reload or test setup recreates the route.
 */
export async function pruneStaleClipboardTempDirs(): Promise<void> {
  const root = serverDataDir()
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  const selfDirName = TEMP_DIR_NAME
  for (const entry of entries) {
    if (!entry.startsWith('clipboard-tmp-') || entry === selfDirName) continue
    try {
      await rm(path.join(root, entry), { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
}
