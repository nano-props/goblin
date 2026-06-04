import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoState, DetailTab, RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { BranchActionControls } from '#/web/components/BranchActionBar.tsx'
import { Toolbar } from '#/web/components/Layout.tsx'
import { detailTabNavigationKey, navigatedDetailTab, visibleDetailTabs } from '#/web/lib/detail-tabs.ts'
import { cn } from '#/web/lib/cn.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-utils.ts'
import { useTerminalCount } from '#/web/components/terminal/terminal-session-store.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { SelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import type { BranchActionItemGroups } from '#/web/hooks/useBranchActionItems.ts'
import { useRuntimeShortcutSettings } from '#/web/runtime-settings-hooks.ts'
interface Props {
  repo: RepoState
  detail: SelectedBranchDetailPresentation
  detailId: string
  contentId: string
  collapsed: boolean
  focusMode: boolean
  layout: RepoWorkspaceLayout
  branchActions?: BranchActionItemGroups
}

export function BranchDetailToolbar({
  repo,
  detail,
  detailId,
  contentId,
  collapsed,
  focusMode,
  layout,
  branchActions,
}: Props) {
  const t = useT()
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const toggleDetailCollapsed = useReposStore((s) => s.toggleDetailCollapsed)
  const toggleDetailFocusMode = useReposStore((s) => s.toggleDetailFocusMode)
  const navigation = useMainWindowNavigation()
  const { shortcutsDisabled, toggleDetailOnActionBarBlankClick } = useRuntimeShortcutSettings()
  const behavior = repoWorkspaceBehavior(layout, collapsed, focusMode)
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

  return (
    <Toolbar variant="detail">
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
                {tab.id === 'terminal' && terminalCount > 0 && (
                  <span className="rounded-sm border border-separator px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {terminalCount}
                  </span>
                )}
              </Button>
            )
          })}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="min-w-2 flex-1 self-stretch"
        onClick={behavior.detailCollapseAllowed && toggleDetailOnActionBarBlankClick ? toggleDetailCollapsed : undefined}
      />
      <div className="flex shrink-0 items-center gap-1">
        {branchActions && layout === 'left-right' && (
          <BranchActionControls actions={branchActions} variant="menu" />
        )}
        {behavior.detailFocusAllowed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDetailFocusMode}
            aria-label={t(behavior.detailFocusMode ? 'branch-detail.exit-focus' : 'branch-detail.focus')}
            title={t(behavior.detailFocusMode ? 'branch-detail.exit-focus-title' : 'branch-detail.focus-title')}
            aria-pressed={behavior.detailFocusMode}
            className={cn(
              behavior.detailFocusMode &&
                'bg-accent text-accent-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {behavior.detailFocusMode ? <Minimize2 /> : <Maximize2 />}
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
