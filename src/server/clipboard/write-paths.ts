import { mkdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { serverDataDir } from '#/shared/data-dir.ts'
import {
  CLIPBOARD_TEMP_FILE_MAX_AGE_MS,
  MAX_PASTE_UPLOAD_FILES,
  PASTE_FILE_MAX_BYTES,
  PasteFileLimitError,
} from '#/shared/clipboard-paste.ts'
import { createClipboardTimestampedFileName, listDirEntries } from '#/shared/clipboard-paste-node.ts'

/**
 * Canonical persistence boundary for clipboard blobs uploaded over HTTP.
 * Returned paths live on the server machine so the server-owned PTY can read
 * them; they are not client-local file paths.
 */

const TEMP_DIR_NAME = `clipboard-tmp-${process.pid}`

export function clipboardTempDir(): string {
  return path.join(serverDataDir(), TEMP_DIR_NAME)
}

const timestampedFileName = createClipboardTimestampedFileName()

export interface SaveClipboardFilesResult {
  /** Absolute paths the PTY can read. */
  paths: string[]
}

/**
 * Persist `File` instances received from the multipart body to the
 * per-process temp directory.
 *
 * Validate the complete batch before creating storage. The authenticated HTTP
 * boundary already caps encoded request bytes; these checks protect the
 * persistence boundary from excessive file sizes and inode consumption.
 */
export async function saveClipboardFiles(files: File[]): Promise<SaveClipboardFilesResult> {
  if (files.length === 0) return { paths: [] }
  if (files.length > MAX_PASTE_UPLOAD_FILES) throw new PasteFileLimitError('count')
  if (files.some(({ size }) => size > PASTE_FILE_MAX_BYTES)) throw new PasteFileLimitError('file')
  const dir = clipboardTempDir()
  await mkdir(dir, { recursive: true })
  const ownedPaths: string[] = []
  try {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      const filePath = path.join(dir, timestampedFileName(i, file.name))
      // Register ownership before writing so a partially created failing file
      // belongs to this request's best-effort cleanup as well.
      ownedPaths.push(filePath)
      await writeFile(filePath, Buffer.from(await file.arrayBuffer()))
    }
  } catch (error) {
    await Promise.allSettled(ownedPaths.map((filePath) => unlink(filePath)))
    throw error
  }
  return { paths: ownedPaths }
}

/**
 * Best-effort sweep of clipboard temp dirs from previous server runs.
 * Called once when the route module is constructed. Idempotent; safe to
 * call multiple times if a hot-reload or test setup recreates the route.
 */
export async function pruneStaleClipboardTempDirs(): Promise<void> {
  const root = serverDataDir()
  const entries = await listDirEntries(root)
  for (const entry of entries) {
    if (!entry.startsWith('clipboard-tmp-') || entry === TEMP_DIR_NAME) continue
    try {
      await rm(path.join(root, entry), { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
}

export async function pruneExpiredClipboardTempFiles(
  now = Date.now(),
  maxAgeMs = CLIPBOARD_TEMP_FILE_MAX_AGE_MS,
): Promise<void> {
  // Server-written blobs live under `serverDataDir()`, which can persist
  // across restarts and reboots; this age cap bounds durable growth in
  // addition to startup cleanup of previous-process dirs.
  const dir = clipboardTempDir()
  const entries = await listDirEntries(dir)
  for (const entry of entries) {
    const filePath = path.join(dir, entry)
    try {
      const info = await stat(filePath)
      if (!info.isFile()) continue
      if (now - info.mtimeMs <= maxAgeMs) continue
      await unlink(filePath)
    } catch {
      // best effort
    }
  }
}
