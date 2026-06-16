import { pathForDroppedFile, saveClipboardFiles } from '#/web/app-shell-client.ts'

export interface PasteResolution {
  /** Absolute paths the PTY can read. May be non-empty even when `failed > 0`. */
  paths: string[]
  /**
   * Number of blobs the resolver handed to the backend that did not come
   * back with a path. Computed as `blobOnly.length - saved.length` —
   * path-attempt successes do not count, they're already in `paths`.
   */
  failed: number
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
 * - `paths.length === 0` → all failed → `paste-file-failed` toast.
 * - `paths.length > 0 && failed > 0` → partial → `paste-file-partial` toast
 *   **in addition** to writing the resolved paths to the PTY.
 */
export async function resolvePastedFiles(files: File[]): Promise<PasteResolution> {
  if (files.length === 0) return { paths: [], failed: 0 }
  const paths: string[] = []
  const blobOnly: File[] = []
  for (const file of files) {
    const p = pathForDroppedFile(file)
    if (p.length > 0) paths.push(p)
    else blobOnly.push(file)
  }
  if (blobOnly.length === 0) return { paths, failed: 0 }
  const saved = await saveClipboardFiles(blobOnly)
  return {
    paths: paths.concat(saved),
    failed: Math.max(0, blobOnly.length - saved.length),
  }
}
