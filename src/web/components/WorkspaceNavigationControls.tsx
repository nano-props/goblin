import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { WorkspaceZenModeToggle } from '#/web/components/WorkspaceZenModeToggle.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'

interface WorkspaceNavigationControlsProps extends Omit<ComponentProps<'div'>, 'children'> {
  repoId?: string
  revealEnabled?: boolean
  onRevealEnter?: () => void
}

export function WorkspaceNavigationControls({
  repoId,
  revealEnabled = false,
  onRevealEnter,
  className,
  ...props
}: WorkspaceNavigationControlsProps) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const history = useReposStore((s) => (repoId ? s.navigationHistoryByRepo[repoId] : undefined))
  const canGoBack = !!history?.backStack.length
  const canGoForward = !!history?.forwardStack.length

  return (
    <div
      {...props}
      data-zen-reveal-surface={revealEnabled ? '' : undefined}
      className={cn('goblin-workspace-navigation-controls pointer-events-auto flex h-full items-center gap-1', className)}
      onMouseEnter={revealEnabled ? onRevealEnter : undefined}
    >
      <WorkspaceZenModeToggle data-testid="zen-mode-sidebar-trigger" />
      <Tip label={t('workspace.navigation-back')}>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={!repoId || !canGoBack}
            aria-label={t('workspace.navigation-back')}
            onClick={() => {
              if (repoId) navigation.goBack(repoId)
            }}
          >
            <ArrowLeft />
          </Button>
        </span>
      </Tip>
      <Tip label={t('workspace.navigation-forward')}>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={!repoId || !canGoForward}
            aria-label={t('workspace.navigation-forward')}
            onClick={() => {
              if (repoId) navigation.goForward(repoId)
            }}
          >
            <ArrowRight />
          </Button>
        </span>
      </Tip>
    </div>
  )
}
