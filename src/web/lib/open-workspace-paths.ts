import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import { sessionLog } from '#/web/logger.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
interface Options {
  ensureWorkspaceOpen: (path: string) => Promise<OpenWorkspaceResult>
  activateWorkspace?: (id: WorkspaceId) => void
  onOpenFailed?: (path: string, message: string) => void
  onPostOpenError?: (path: string, message: string) => void
}

export async function openWorkspacePaths(
  paths: string[],
  { ensureWorkspaceOpen, activateWorkspace, onOpenFailed, onPostOpenError }: Options,
): Promise<WorkspaceId | null> {
  let firstId: WorkspaceId | null = null
  for (const path of paths) {
    const result = await ensureWorkspaceOpen(path)
    if (!result.ok) {
      onOpenFailed?.(path, result.message)
      continue
    }
    firstId ??= result.workspaceId
    if (result.postOpenEffects) {
      void result.postOpenEffects
        .then((errors) => {
          for (const error of errors) onPostOpenError?.(path, error.message)
        })
        .catch((err) => {
          sessionLog.warn('post-open workspace effects failed', { path, err })
        })
    }
  }
  if (firstId !== null) activateWorkspace?.(firstId)
  return firstId
}
