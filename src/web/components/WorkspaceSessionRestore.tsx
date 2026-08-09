import { AlertTriangle, RefreshCw } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { CenteredLoadingStatus } from '#/web/components/CenteredLoadingStatus.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import type { AuthenticatedAppBootstrapState } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

export const WorkspaceSessionRestorePlaceholder = defineComponent({
  name: 'WorkspaceSessionRestorePlaceholder',
  setup() {
    return () => <CenteredLoadingStatus label="Restoring workspace" />
  },
})

type FailedBootstrapState = Extract<AuthenticatedAppBootstrapState, { status: 'failed' }>

export const WorkspaceSessionRestoreError = defineComponent<{ state: FailedBootstrapState; retry: () => void }>({
  name: 'WorkspaceSessionRestoreError',
  props: {
    state: { type: Object as PropType<FailedBootstrapState>, required: true },
    retry: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    const t = useT()
    return () => (
      <div class="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={<AlertTriangle size={18} />}
          title={t('workspace-restore.failed')}
          body={
            <div class="space-y-3">
              <div class="break-words">{props.state.message}</div>
              <Button type="button" variant="outline" onClick={props.retry}>
                <RefreshCw />
                {t('error.try-again')}
              </Button>
            </div>
          }
        />
      </div>
    )
  },
})
