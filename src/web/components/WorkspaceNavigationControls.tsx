import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { WorkspaceZenModeToggle } from '#/web/components/WorkspaceZenModeToggle.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'

interface WorkspaceNavigationControlsProps extends Omit<ComponentProps<'div'>, 'children'> {
  workspaceId?: string
  zenRevealTriggerEnabled?: boolean
  onZenRevealTriggerEnter?: () => void
}

export function WorkspaceNavigationControls({
  workspaceId,
  zenRevealTriggerEnabled = false,
  onZenRevealTriggerEnter,
  className,
  ...props
}: WorkspaceNavigationControlsProps) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const history = useWorkspacesStore((s) => (workspaceId ? s.navigationHistoryByWorkspace[workspaceId] : undefined))
  const canGoBack = !!history?.backStack.length
  const canGoForward = !!history?.forwardStack.length

  return (
    <div
      {...props}
      className={cn(
        'goblin-workspace-navigation-controls pointer-events-auto flex h-full items-center gap-1',
        className,
      )}
    >
      <span
        className="inline-flex"
        data-zen-reveal-surface={zenRevealTriggerEnabled ? '' : undefined}
        onMouseEnter={zenRevealTriggerEnabled ? onZenRevealTriggerEnter : undefined}
      >
        <WorkspaceZenModeToggle data-testid="zen-mode-sidebar-trigger" />
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        disabled={!workspaceId || !canGoBack}
        aria-label={t('workspace.navigation-back')}
        onClick={() => {
          if (workspaceId) navigation.goBack(workspaceId)
        }}
      >
        <ArrowLeft />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        disabled={!workspaceId || !canGoForward}
        aria-label={t('workspace.navigation-forward')}
        onClick={() => {
          if (workspaceId) navigation.goForward(workspaceId)
        }}
      >
        <ArrowRight />
      </Button>
    </div>
  )
}
