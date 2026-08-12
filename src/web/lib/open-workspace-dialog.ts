import { toast } from 'vue-sonner'
import { chooseLocalWorkspacePath, hasNativeDirectoryPicker } from '#/web/app-shell-client.ts'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
interface Options {
  openWorkspaceMembership: (path: string) => Promise<OpenWorkspaceResult>
  activateWorkspace?: (workspaceId: WorkspaceId) => void
  openWorkspacePathDialog?: () => void
  t: (key: string) => string
}

export async function openWorkspaceFromDialog({
  openWorkspaceMembership,
  activateWorkspace,
  openWorkspacePathDialog,
  t,
}: Options): Promise<void> {
  if (!hasNativeDirectoryPicker()) {
    openWorkspacePathDialog?.()
    return
  }
  const path = await chooseLocalWorkspacePath()
  if (!path) return
  const result = await openWorkspaceMembership(path)
  if (!result.ok) {
    const message = t('drop.open-failed')
    const options = { description: t(result.message) }
    if (result.kind === 'uncertain') toast.warning(message, options)
    else toast.error(message, options)
    return
  }
  reportOpenWorkspacePostOpenEffects(result, t)
  activateWorkspace?.(result.workspaceId)
}
