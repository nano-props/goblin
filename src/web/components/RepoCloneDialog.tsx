import { toast } from 'sonner'
import { CloneRepositoryDialog, type CloneRepositoryInput } from '#/web/components/CloneRepositoryDialog.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { cloneRepository as runCloneRepository } from '#/web/repo-client.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
import { sessionLog } from '#/web/logger.ts'
import type { CloneRepoResult } from '#/shared/api-types.ts'

const POST_CLONE_FAILURE_TITLE_KEYS = {
  'open-failed': 'drop.open-failed',
  'open-uncertain': 'workspace-picker.clone-open-uncertain',
  'presentation-failed': 'workspace-picker.clone-presentation-failed',
} as const

interface RepoCloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RepoCloneDialog({ open, onOpenChange }: RepoCloneDialogProps) {
  const t = useT()
  const ensureWorkspaceOpen = useWorkspacesStore((s) => s.ensureWorkspaceOpen)
  const navigation = useAppNavigation()

  function reportPostCloneFailure(
    kind: 'open-failed' | 'open-uncertain' | 'presentation-failed',
    path: string,
    getDescription: () => string,
  ) {
    const titleKey = POST_CLONE_FAILURE_TITLE_KEYS[kind]
    try {
      toast.error(t(titleKey), {
        description: `${path}\n${getDescription()}`,
      })
    } catch (err) {
      sessionLog.warn('failed to report post-clone workflow failure', { kind, path, err })
    }
  }

  async function runPostCloneWorkflow(path: string, signal: AbortSignal): Promise<void> {
    let phase: 'open' | 'presentation' = 'open'
    try {
      const openResult = await ensureWorkspaceOpen(path)
      if (signal.aborted) return
      if (!openResult.ok) {
        const messageKey = openResult.message
        reportPostCloneFailure('open-failed', path, () => t(messageKey))
        return
      }
      phase = 'presentation'
      navigation.activateWorkspace(openResult.workspaceId)
      reportOpenWorkspacePostOpenEffects(openResult, t, { descriptionPrefix: path })
      toast.success(t('workspace-picker.clone-opened'), { description: path })
    } catch (err) {
      if (signal.aborted) return
      const message = err instanceof Error ? err.message : null
      reportPostCloneFailure(
        phase === 'open' ? 'open-uncertain' : 'presentation-failed',
        path,
        () => message ?? t('error.unknown'),
      )
    }
  }

  async function handleClone(input: CloneRepositoryInput, signal: AbortSignal): Promise<CloneRepoResult> {
    const result = await runCloneRepository(input, { signal })
    if (!result.ok || !result.path || signal.aborted) return result
    await runPostCloneWorkflow(result.path, signal)
    return result
  }

  return <CloneRepositoryDialog open={open} onClose={() => onOpenChange(false)} onClone={handleClone} />
}
