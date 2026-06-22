import { pathForDroppedFile, saveClipboardFiles } from '#/web/app-shell-client.ts'
import { isTerminalPastePathSafe } from '#/shared/clipboard-paste.ts'

export interface PasteResolution {
  /** Absolute paths the PTY can read. May be non-empty even when failures are present. */
  paths: string[]
  /**
   * Number of path-attempt results rejected because they contain terminal
   * control bytes that would be interpreted before shell quoting applies.
   */
  failedUnsafe: number
  /**
   * Number of blobs the resolver handed to the backend that did not come
   * back with a path. Computed as `blobOnly.length - saved.length` —
   * path-attempt successes do not count, they're already in `paths`.
   */
  failedBackend: number
}

/**
 * Two-tier paste resolver.
 *
 * 1. **Path attempt** — Electron's preload returns absolute paths for
 *    files copied from the OS filesystem (`webUtils.getPathForFile`).
 *    The web bridge always returns `''`, so this tier is effectively
 *    skipped on web.
 * 2. **Blob save** — persist remaining blobs via the runtime backend.
 *    Electron writes through `goblin:clipboard-save-binary-files` IPC;
 *    web POSTs multipart to `/api/clipboard/files`. The backend either
 *    returns one path per input or `[]` on transport failure.
 *
 * Caller surfaces:
 * - `paths.length === 0` and backend failures → `paste-file-failed` toast.
 * - unsafe path failures → `paste-file-unsafe` toast.
 * - `paths.length > 0 && failedBackend > 0` → partial → `paste-file-partial` toast
 *   **in addition** to writing the resolved paths to the PTY.
 */
export async function resolvePastedFiles(files: File[]): Promise<PasteResolution> {
  if (files.length === 0) return { paths: [], failedUnsafe: 0, failedBackend: 0 }
  const paths: string[] = []
  const blobOnly: File[] = []
  let failedUnsafe = 0
  for (const file of files) {
    const p = pathForDroppedFile(file)
    if (p.length > 0) {
      if (isTerminalPastePathSafe(p)) paths.push(p)
      else failedUnsafe += 1
    } else {
      blobOnly.push(file)
    }
  }
  if (blobOnly.length === 0) return { paths, failedUnsafe, failedBackend: 0 }
  const saved = await saveClipboardFiles(blobOnly)
  return {
    paths: paths.concat(saved),
    failedUnsafe,
    failedBackend: Math.max(0, blobOnly.length - saved.length),
  }
}
