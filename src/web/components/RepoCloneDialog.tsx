import { toast } from 'sonner'
import { CloneRepositoryDialog, type CloneRepositoryInput } from '#/web/components/CloneRepositoryDialog.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { cloneRepository as runCloneRepository } from '#/web/repo-client.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
import { sessionLog } from '#/web/logger.ts'
import type { CloneRepoResult } from '#/shared/api-types.ts'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'

interface RepoCloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoCloneDialog({ open, onOpenChange }: RepoCloneDialogProps) {
  const t = useT()
  const openWorkspaceMembership = useWorkspacesStore((s) => s.openWorkspaceMembership)
  const navigation = useAppNavigation()

  function reportAutomaticOpenFailure(path: string, message: string) {
    toast.error(t('workspace-picker.clone-follow-up-failed'), {
      description: `${path}\n${message}`,
    })
  }

  async function openClonedWorkspace(path: string, signal: AbortSignal): Promise<OpenWorkspaceResult> {
    const openResult = await openWorkspaceMembership(path)
    if (signal.aborted || !openResult.ok) return openResult
    navigation.activateWorkspace(openResult.workspaceId)
    reportOpenWorkspacePostOpenEffects(openResult, t, { descriptionPrefix: path })
    toast.success(t('workspace-picker.clone-opened'), { description: path })
    return openResult
  }

  async function handleClone(input: CloneRepositoryInput, signal: AbortSignal): Promise<CloneRepoResult> {
    const result = await runCloneRepository(input, { signal })
    if (!result.ok || !result.path || signal.aborted) return result
    const path = result.path
    let openResult: OpenWorkspaceResult
    try {
      openResult = await openClonedWorkspace(path, signal)
    } catch (err) {
      if (signal.aborted) return result
      const message = err instanceof Error ? err.message : t('error.unknown')
      sessionLog.warn('failed to open cloned workspace automatically', { path, err })
      reportAutomaticOpenFailure(path, message)
      return result
    }
    if (!openResult.ok && !signal.aborted) {
      const messageKey = openResult.message
      reportAutomaticOpenFailure(path, t(messageKey))
    }
    return result
  }

  return <CloneRepositoryDialog open={open} onClose={() => onOpenChange(false)} onClone={handleClone} />
}
