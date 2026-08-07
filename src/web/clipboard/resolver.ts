import { pathForDroppedFile, saveClipboardFiles } from '#/web/app-shell-client.ts'
import {
  isTerminalPastePathSafe,
  MAX_PASTE_BATCH_BYTES,
  MAX_PASTE_UPLOAD_FILES,
  PASTE_FILE_MAX_BYTES,
  PasteFileLimitError,
} from '#/shared/clipboard-paste.ts'

export interface PasteResolution {
  /** Absolute paths the PTY can read, in the same order as the input files. */
  paths: string[]
}

/**
 * Two-tier paste resolver.
 *
 * 1. **Path attempt** — Electron's preload returns absolute paths for
 *    files copied from the OS filesystem (`webUtils.getPathForFile`).
 *    The web bridge always returns `''`, so this tier is effectively
 *    skipped on web.
 * 2. **Blob save** — persist remaining blobs through the shared server endpoint.
 *    Both browser and Electron clients POST multipart to `/api/clipboard/files`. Backend failures reject
 *    and are surfaced by the caller.
 *
 * Backend failures and incomplete results reject the whole resolution. The
 * caller writes only a complete, ordered path list.
 */
export async function resolvePastedFiles(files: File[]): Promise<PasteResolution> {
  if (files.length === 0) return { paths: [] }
  const paths: Array<string | undefined> = files.map(() => undefined)
  const blobOnly: Array<{ file: File; inputIndex: number }> = []
  for (let inputIndex = 0; inputIndex < files.length; inputIndex += 1) {
    const file = files[inputIndex]
    const p = pathForDroppedFile(file)
    if (p.length > 0) {
      if (isTerminalPastePathSafe(p)) {
        paths[inputIndex] = p
      } else {
        // Real files whose on-disk path contains terminal control bytes
        // should fall back to blob-save rather than becoming unusable.
        // The temp-file path is sanitised by the runtime backend and
        // re-checked by `planTerminalPathWrite` before PTY write.
        blobOnly.push({ file, inputIndex })
      }
    } else {
      blobOnly.push({ file, inputIndex })
    }
  }
  if (blobOnly.length === 0) return { paths: paths.map(requireResolvedPath) }
  if (blobOnly.length > MAX_PASTE_UPLOAD_FILES) throw new PasteFileLimitError('count')
  if (blobOnly.some(({ file }) => file.size > PASTE_FILE_MAX_BYTES)) throw new PasteFileLimitError('file')
  if (blobOnly.reduce((total, { file }) => total + file.size, 0) > MAX_PASTE_BATCH_BYTES) {
    throw new PasteFileLimitError('batch')
  }
  const saved = await saveClipboardFiles(blobOnly.map(({ file }) => file))
  // The app-shell boundary is one-to-one. Keep this assertion here as well as
  // in the HTTP backend because this resolver owns the input-order join and
  // must never guess which file an incomplete result belongs to.
  if (saved.length !== blobOnly.length) throw new Error('Incomplete clipboard file response')
  for (let savedIndex = 0; savedIndex < saved.length; savedIndex += 1) {
    paths[blobOnly[savedIndex].inputIndex] = saved[savedIndex]
  }
  return { paths: paths.map(requireResolvedPath) }
}

function requireResolvedPath(path: string | undefined): string {
  if (path === undefined) throw new Error('Incomplete clipboard file response')
  return path
}
