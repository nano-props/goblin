import { toast } from 'sonner'
import { chooseLocalWorkspacePath, hasNativeDirectoryPicker } from '#/web/app-shell-client.ts'
import type { OpenWorkspaceResult } from '#/web/stores/repos/types.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
interface Options {
  ensureWorkspaceOpen: (path: string) => Promise<OpenWorkspaceResult>
  activateWorkspace?: (workspaceId: string) => void
  openWorkspacePathDialog?: () => void
  t: (key: string) => string
}

export async function openWorkspaceFromDialog({
  ensureWorkspaceOpen,
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
  const result = await ensureWorkspaceOpen(path)
  if (!result.ok) {
    toast.error(t('drop.open-failed'), {
      description: t(result.message),
    })
    return
  }
  reportOpenWorkspacePostOpenEffects(result, t)
  activateWorkspace?.(result.workspaceId)
}
