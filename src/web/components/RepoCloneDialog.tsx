import { defineComponent } from 'vue'
import { toast } from 'vue-sonner'
import type { CloneRepoResult } from '#/shared/api-types.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { CloneRepositoryDialog } from '#/web/components/CloneRepositoryDialog.tsx'
import type { CloneRepositoryInput } from '#/web/components/CloneRepositoryDialog.tsx'
import {
  reportOpenWorkspacePostOpenEffects,
  reportOpenWorkspaceUncertainty,
} from '#/web/lib/open-workspace-result-feedback.ts'
import { sessionLog } from '#/web/logger.ts'
import { cloneRepository as runCloneRepository } from '#/web/repo-client.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'

interface RepoCloneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const RepoCloneDialog = defineComponent<RepoCloneDialogProps>({
  name: 'RepoCloneDialog',
  props: ['open', 'onOpenChange'],
  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()

    function reportAutomaticOpenFailure(path: string, message: string): void {
      toast.error(t('workspace-picker.clone-follow-up-failed'), {
        description: `${path}\n${message}`,
      })
    }

    async function openClonedWorkspace(path: string, signal: AbortSignal): Promise<OpenWorkspaceResult> {
      const openResult = await workspacesStore.getState().openWorkspaceMembership(path)
      if (signal.aborted || !openResult.ok) return openResult
      navigation.activateWorkspace(openResult.workspaceId)
      reportOpenWorkspacePostOpenEffects(openResult, t, { descriptionPrefix: path })
      toast.success(t('workspace-picker.clone-opened'), { description: path })
      return openResult
    }

    async function cloneRepository(input: CloneRepositoryInput, signal: AbortSignal): Promise<CloneRepoResult> {
      const result = await runCloneRepository(input, { signal })
      if (!result.ok || !result.path || signal.aborted) return result
      const path = result.path
      let openResult: OpenWorkspaceResult
      try {
        openResult = await openClonedWorkspace(path, signal)
      } catch (error) {
        if (signal.aborted) return result
        const message = error instanceof Error ? error.message : t('error.unknown')
        sessionLog.warn('failed to open cloned workspace automatically', { path, err: error })
        reportAutomaticOpenFailure(path, message)
        return result
      }
      if (!openResult.ok && !signal.aborted) {
        if (!reportOpenWorkspaceUncertainty(openResult, t, { descriptionPrefix: path })) {
          reportAutomaticOpenFailure(path, t(openResult.message))
        }
      }
      return result
    }

    return () => (
      <CloneRepositoryDialog open={props.open} onClose={() => props.onOpenChange(false)} onClone={cloneRepository} />
    )
  },
})
