import { AlertCircle, RefreshCw, X } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { toast } from 'vue-sonner'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'

interface WorkspaceProjectionFailureViewProps {
  workspace: WorkspaceState
  message: string
  onRetry: () => void
}

export const WorkspaceProjectionFailureView = defineComponent<WorkspaceProjectionFailureViewProps>({
  name: 'WorkspaceProjectionFailureView',
  props: {
    workspace: { type: Object as PropType<WorkspaceState>, required: true },
    message: { type: String, required: true },
    onRetry: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()

    async function handleClose() {
      const result = await navigation.closeWorkspace(props.workspace.id)
      if (!result.ok) {
        const messageKey = result.message
        toast.error(t(messageKey))
      }
    }

    return () => (
      <section class="flex min-w-0 flex-1 flex-col">
        <EmptyState
          icon={<AlertCircle size={18} />}
          title={t('lazy-restore.failed')}
          body={
            <div class="space-y-3">
              <div class="break-words">{props.message}</div>
              <div class="flex justify-center gap-2">
                <Button type="button" variant="default" onClick={props.onRetry}>
                  <RefreshCw />
                  {t('error.try-again')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => void handleClose()}>
                  <X />
                  {t('workspace-unavailable.close')}
                </Button>
              </div>
            </div>
          }
        />
      </section>
    )
  },
})
