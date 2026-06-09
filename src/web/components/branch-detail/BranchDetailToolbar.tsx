import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, type KeyboardEvent } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { DetailTab, RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Badge } from '#/web/components/ui/badge.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { BranchActionControls } from '#/web/components/BranchActionControls.tsx'
import { Toolbar } from '#/web/components/Layout.tsx'
import { detailTabNavigationKey, navigatedDetailTab, visibleDetailTabs } from '#/web/lib/detail-tabs.ts'
import { cn } from '#/web/lib/cn.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-utils.ts'
import { useTerminalCount } from '#/web/components/terminal/terminal-session-store.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { BranchDetailRepo, SelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import type { BranchActionItemGroups } from '#/web/hooks/useBranchActionItems.ts'
import { useRuntimeShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import {
  branchDetailToolbarStoreActionsEqual,
  branchDetailToolbarStoreActionsFromStore,
} from '#/web/stores/repos/selector-actions.ts'
interface Props {
  repo: Pick<BranchDetailRepo, 'id' | 'ui'>
  detail: SelectedBranchDetailPresentation
  detailId: string
  contentId: string
  collapsed: boolean
  detailFocusMode: boolean
  layout: RepoWorkspaceLayout
  branchActions?: BranchActionItemGroups
}

export function BranchDetailToolbar({
  repo,
  detail,
  detailId,
  contentId,
  collapsed,
  detailFocusMode,
  layout,
  branchActions,
}: Props) {
  const t = useT()
  const { setDetailCollapsed, toggleDetailCollapsed, toggleDetailFocusMode } = useStoreWithEqualityFn(
    useReposStore,
    branchDetailToolbarStoreActionsFromStore,
    branchDetailToolbarStoreActionsEqual,
  )
  const navigation = useMainWindowNavigation()
  const { shortcutsDisabled, toggleDetailOnActionBarBlankClick } = useRuntimeShortcutSettings()
  const behavior = repoWorkspaceBehavior(layout, collapsed, detailFocusMode)
  const tabs = visibleDetailTabs(!!detail.branch?.worktree?.path)
  const terminalWorktreeKey = detail.branch?.worktree?.path ? worktreeTerminalKey(repo.id, detail.branch.worktree.path) : null
  const terminalCount = useTerminalCount(terminalWorktreeKey)

  // No selected branch means there is no tab/action target; BranchDetailContent renders the empty state.
  if (!detail.branch) return null

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, tabId: DetailTab) {
    const key = detailTabNavigationKey(e.key)
    if (!key) return
    e.preventDefault()
    const nextTab = navigatedDetailTab(tabId, key, !!detail.branch?.worktree?.path)
    navigation.showRepoDetailTab(repo.id, nextTab)
    setDetailCollapsed(false)
    // The tablist stays mounted even when the panel is collapsed; optional chaining guards transient unmounts.
    window.requestAnimationFrame(() => document.getElementById(`${detailId}-${nextTab}-tab`)?.focus())
  }

  const detailToggleTitle = t(
    shortcutsDisabled
      ? collapsed
        ? 'branch-detail.expand'
        : 'branch-detail.collapse'
      : collapsed
        ? 'branch-detail.expand-title'
        : 'branch-detail.collapse-title',
  )
  const showBranchActions = !!branchActions && (layout === 'left-right' || behavior.mode === 'focus')
  const showPanelControls = behavior.detailFocusAllowed || behavior.detailCollapseAllowed
  const focusTogglePressed = behavior.detailFocusMode

  const blankClickEnabled = behavior.detailCollapseAllowed && toggleDetailOnActionBarBlankClick
  const handleToolbarBlankClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!blankClickEnabled) return
      const target = e.target as HTMLElement
      // Only toggle when clicking truly blank space (not on any interactive element)
      if (target.closest('button, a, input, select, textarea, [role="tab"], [role="button"], [data-interactive]')) return
      toggleDetailCollapsed()
    },
    [blankClickEnabled, toggleDetailCollapsed],
  )

  return (
    <Toolbar variant="detail" onClick={handleToolbarBlankClick}>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <div className="flex shrink-0 gap-1" role="tablist" aria-label={t('tab.branch-detail')}>
          {tabs.map((tab) => {
            const selected = repo.ui.detailTab === tab.id
            const visuallySelected = !collapsed && selected
            return (
              <Button
                key={tab.id}
                id={`${detailId}-${tab.id}-tab`}
                type="button"
                variant="ghost"
                role="tab"
                aria-selected={selected}
                aria-expanded={selected ? !collapsed : undefined}
                aria-controls={collapsed ? undefined : `${detailId}-${tab.id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  navigation.showRepoDetailTab(repo.id, tab.id)
                  setDetailCollapsed(false)
                }}
                onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
                className={cn(
                  'h-7 gap-1.5 px-2.5 text-sm font-normal',
                  visuallySelected
                    ? 'bg-selected text-selected-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                {t(tab.labelKey)}
                {tab.id === 'changes' && detail.statusCount > 0 && (
                  <Badge variant="attention" className="font-normal font-mono tabular-nums">
                    {detail.statusCount}
                  </Badge>
                )}
                {tab.id === 'terminal' && terminalCount > 0 && (
                  <Badge variant="outline" className="font-normal font-mono tabular-nums text-muted-foreground">
                    {terminalCount}
                  </Badge>
                )}
              </Button>
            )
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {showBranchActions && (
          <BranchActionControls actions={branchActions} variant="menu" />
        )}
        {showBranchActions && showPanelControls && (
          <div aria-hidden="true" data-testid="branch-detail-toolbar-divider" className="mx-1 h-4 border-l border-separator/70" />
        )}
        {behavior.detailFocusAllowed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDetailFocusMode}
            aria-label={t(focusTogglePressed ? 'branch-detail.exit-focus' : 'branch-detail.focus')}
            title={t(focusTogglePressed ? 'branch-detail.exit-focus-title' : 'branch-detail.focus-title')}
            aria-pressed={focusTogglePressed}
            className={cn(
              focusTogglePressed && 'bg-accent text-accent-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {focusTogglePressed ? <Minimize2 /> : <Maximize2 />}
          </Button>
        )}
        {behavior.detailCollapseAllowed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDetailCollapsed}
            aria-label={t(collapsed ? 'branch-detail.expand' : 'branch-detail.collapse')}
            title={detailToggleTitle}
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : contentId}
          >
            <ChevronDown className={cn(collapsed && '-rotate-90')} />
          </Button>
        )}
      </div>
    </Toolbar>
  )
}
