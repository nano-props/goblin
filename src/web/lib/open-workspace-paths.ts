import type {
  OpenWorkspaceFailure,
  OpenWorkspacePostOpenError,
  OpenWorkspaceResult,
} from '#/web/stores/workspaces/types.ts'
import { sessionLog } from '#/web/logger.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
interface Options {
  openWorkspaceMembership: (path: string) => Promise<OpenWorkspaceResult>
  activateWorkspace?: (id: WorkspaceId) => void
  onOpenFailed?: (path: string, result: OpenWorkspaceFailure) => void
  onPostOpenError?: (path: string, error: OpenWorkspacePostOpenError) => void
}

export async function openWorkspacePaths(
  paths: string[],
  { openWorkspaceMembership, activateWorkspace, onOpenFailed, onPostOpenError }: Options,
): Promise<WorkspaceId | null> {
  let firstId: WorkspaceId | null = null
  for (const path of paths) {
    const result = await openWorkspaceMembership(path)
    if (!result.ok) {
      onOpenFailed?.(path, result)
      if (result.kind === 'uncertain') break
      continue
    }
    firstId ??= result.workspaceId
    if (result.postOpenEffects) {
      void result.postOpenEffects
        .then((errors) => {
          for (const error of errors) onPostOpenError?.(path, error)
        })
        .catch((err) => {
          sessionLog.warn('post-open workspace effects failed', { path, err })
        })
    }
  }
  if (firstId !== null) activateWorkspace?.(firstId)
  return firstId
}
