import { saveClipboardFiles } from '#/web/app/shell-client.ts'
import {
  MAX_PASTE_BATCH_BYTES,
  MAX_PASTE_UPLOAD_FILES,
  PASTE_FILE_MAX_BYTES,
  PasteFileLimitError,
} from '#/shared/clipboard-paste.ts'

export interface PasteResolution {
  /** Absolute paths the PTY can read, in the same order as the input files. */
  paths: string[]
}

/** Upload browser files in order; reject limits and incomplete responses before writing to the PTY. */
export async function resolvePastedFiles(files: File[]): Promise<PasteResolution> {
  if (files.length === 0) return { paths: [] }
  if (files.length > MAX_PASTE_UPLOAD_FILES) throw new PasteFileLimitError('count')
  if (files.some((file) => file.size > PASTE_FILE_MAX_BYTES)) throw new PasteFileLimitError('file')
  if (files.reduce((total, file) => total + file.size, 0) > MAX_PASTE_BATCH_BYTES) {
    throw new PasteFileLimitError('batch')
  }
  const saved = await saveClipboardFiles(files)
  // The app-shell boundary is one-to-one. Keep this assertion here as well as
  // in the HTTP backend because this resolver owns the input-order join and
  // must never guess which file an incomplete result belongs to.
  if (saved.length !== files.length) throw new Error('Incomplete clipboard file response')
  return { paths: saved }
}
