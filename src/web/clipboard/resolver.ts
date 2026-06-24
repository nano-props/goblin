import { pathForDroppedFile, saveClipboardFiles } from '#/web/app-shell-client.ts'
import { isTerminalPastePathSafe } from '#/shared/clipboard-paste.ts'

export interface PasteResolution {
  /** Absolute paths the PTY can read. May be non-empty even when failures are present. */
  paths: string[]
  /**
   * Reserved count of unsafe-to-type paths. The resolver always
   * returns 0 here: unsafe path-attempt results fall back to
   * blob-save, and the runtime backend sanitises filenames before
   * writing temp files. `planTerminalPathWrite` is the final
   * authority on what's safe to type into the PTY — it reads this
   * field and increments it again for any returned path that still
   * contains terminal control bytes.
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
 * - unsafe returned paths (detected later by `planTerminalPathWrite`) → `paste-file-unsafe` toast.
 * - `paths.length > 0 && failedBackend > 0` → partial → `paste-file-partial` toast
 *   **in addition** to writing the resolved paths to the PTY.
 */
export async function resolvePastedFiles(files: File[]): Promise<PasteResolution> {
  if (files.length === 0) return { paths: [], failedUnsafe: 0, failedBackend: 0 }
  const paths: string[] = []
  const blobOnly: File[] = []
  for (const file of files) {
    const p = pathForDroppedFile(file)
    if (p.length > 0) {
      if (isTerminalPastePathSafe(p)) {
        paths.push(p)
      } else {
        // Real files whose on-disk path contains terminal control bytes
        // should fall back to blob-save rather than becoming unusable.
        // The temp-file path is sanitised by the runtime backend and
        // re-checked by `planTerminalPathWrite` before PTY write.
        blobOnly.push(file)
      }
    } else {
      blobOnly.push(file)
    }
  }
  if (blobOnly.length === 0) return { paths, failedUnsafe: 0, failedBackend: 0 }
  const saved = await saveClipboardFiles(blobOnly)
  return {
    paths: paths.concat(saved),
    failedUnsafe: 0,
    failedBackend: Math.max(0, blobOnly.length - saved.length),
  }
}
