import type { OpenRepoResult } from '#/web/stores/repos/types.ts'
import { sessionLog } from '#/web/logger.ts'
interface Options {
  ensureWorkspaceOpen: (path: string) => Promise<OpenRepoResult>
  activateRepo?: (id: string) => void
  onOpenFailed?: (path: string, message: string) => void
  onPostOpenError?: (path: string, message: string) => void
}

export async function openRepoPaths(
  paths: string[],
  { ensureWorkspaceOpen, activateRepo, onOpenFailed, onPostOpenError }: Options,
): Promise<string | null> {
  let firstId: string | null = null
  for (const path of paths) {
    const result = await ensureWorkspaceOpen(path)
    if (!result.ok) {
      onOpenFailed?.(path, result.message)
      continue
    }
    firstId ??= result.id
    if (result.postOpenEffects) {
      void result.postOpenEffects
        .then((errors) => {
          for (const error of errors) onPostOpenError?.(path, error.message)
        })
        .catch((err) => {
          sessionLog.warn('post-open repo effects failed', { path, err })
        })
    }
  }
  if (firstId !== null) activateRepo?.(firstId)
  return firstId
}
