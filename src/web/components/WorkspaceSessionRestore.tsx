import { createContext, useContext, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { CenteredLoadingStatus } from '#/web/components/CenteredLoadingStatus.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import type {
  AuthenticatedAppBootstrapResult,
  AuthenticatedAppBootstrapState,
} from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { useT } from '#/web/stores/i18n.ts'

export const AuthenticatedWorkspaceRestoreContext = createContext<AuthenticatedAppBootstrapResult>({
  state: { status: 'restoring-workspace' },
  retry: () => {},
})

export function WorkspaceSessionRestoreGate({ children }: { children: ReactNode }) {
  const bootstrap = useContext(AuthenticatedWorkspaceRestoreContext)
  const bootstrapState = bootstrap.state
  if (bootstrapState.status === 'restoring-workspace') return <WorkspaceSessionRestorePlaceholder />
  if (bootstrapState.status === 'failed') {
    return <WorkspaceSessionRestoreError state={bootstrapState} retry={bootstrap.retry} />
  }
  return <>{children}</>
}

export function WorkspaceSessionRestorePlaceholder() {
  return <CenteredLoadingStatus label="Restoring workspace" />
}

export function WorkspaceSessionRestoreError({
  state,
  retry,
}: {
  state: Extract<AuthenticatedAppBootstrapState, { status: 'failed' }>
  retry: () => void
}) {
  const t = useT()
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={<AlertTriangle size={18} />}
        title={t('workspace-restore.failed')}
        body={
          <div className="space-y-3">
            <div className="break-words">{state.message}</div>
            <Button type="button" variant="outline" onClick={retry}>
              <RefreshCw />
              {t('error.try-again')}
            </Button>
          </div>
        }
      />
    </div>
  )
}
