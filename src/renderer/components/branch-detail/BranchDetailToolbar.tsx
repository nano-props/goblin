import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState, DetailTab, RepoWorkspaceLayout } from '#/renderer/stores/repos/types.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { BranchActionControls } from '#/renderer/components/BranchActionBar.tsx'
import { Toolbar } from '#/renderer/components/Layout.tsx'
import { detailTabNavigationKey, navigatedDetailTab, visibleDetailTabs } from '#/renderer/lib/detail-tabs.ts'
import { cn } from '#/renderer/lib/cn.ts'
import { repoWorkspaceBehavior } from '#/renderer/lib/workspace-layout.ts'
import { terminalSessionGroupKey } from '#/renderer/components/terminal/terminal-session-utils.ts'
import { useTerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import type { SelectedBranchDetailPresentation } from '#/renderer/components/branch-detail/model.ts'
import type { BranchActionItemGroups } from '#/renderer/hooks/useBranchActionItems.ts'

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
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const toggleDetailCollapsed = useReposStore((s) => s.toggleDetailCollapsed)
  const toggleDetailFocusMode = useReposStore((s) => s.toggleDetailFocusMode)
  const shortcutsDisabled = useSettingsStore((s) => s.shortcutsDisabled)
  const toggleDetailOnActionBarBlankClick = useSettingsStore((s) => s.toggleDetailOnActionBarBlankClick)
  const terminalContext = useTerminalSessionContext()
  const behavior = repoWorkspaceBehavior(layout, collapsed, focusMode)
  const tabs = visibleDetailTabs(!!detail.branch?.worktree?.path)
  const terminalCount = detail.branch?.worktree?.path
    ? terminalContext.sessionSummaries(terminalSessionGroupKey(repo.id, detail.branch.worktree?.path)).length
    : 0

  // No selected branch means there is no tab/action target; BranchDetailContent renders the empty state.
  if (!detail.branch) return null

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, tabId: DetailTab) {
    const key = detailTabNavigationKey(e.key)
    if (!key) return
    e.preventDefault()
    const nextTab = navigatedDetailTab(tabId, key, !!detail.branch?.worktree?.path)
    setDetailTab(repo.id, nextTab)
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
      <div className="flex shrink-0 items-center gap-1">
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
        {behavior.detailFocusAllowed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDetailFocusMode}
            aria-label={t(behavior.detailFocusMode ? 'branch-detail.exit-focus' : 'branch-detail.focus')}
            // No accelerator is registered for focus mode, so the title intentionally omits shortcut text.
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
                  setDetailTab(repo.id, tab.id)
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
                  <Badge variant="attention" className="font-mono tabular-nums">
                    {detail.statusCount}
                  </Badge>
                )}
                {tab.id === 'terminal' && terminalCount > 0 && (
                  <Badge variant="outline" className="font-mono tabular-nums text-muted-foreground">
                    {terminalCount}
                  </Badge>
                )}
              </Button>
            )
          })}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="min-w-2 flex-1 self-stretch"
        onClick={
          toggleDetailOnActionBarBlankClick && behavior.detailCollapseAllowed ? toggleDetailCollapsed : undefined
        }
      />
      {branchActions && <BranchActionControls actions={branchActions} variant={behavior.detailActionVariant} />}
    </Toolbar>
  )
}
