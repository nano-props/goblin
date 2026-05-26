import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState, DetailTab, RepoWorkspaceLayout } from '#/renderer/stores/repos/types.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { BranchActionBar } from '#/renderer/components/BranchActionBar.tsx'
import { Toolbar } from '#/renderer/components/Layout.tsx'
import { detailTabNavigationKey, navigatedDetailTab, visibleDetailTabs } from '#/renderer/lib/detail-tabs.ts'
import { cn } from '#/renderer/lib/cn.ts'
import { repoWorkspaceBehavior } from '#/renderer/lib/workspace-layout.ts'
import { terminalSessionGroupKey } from '#/renderer/components/terminal/terminal-session-utils.ts'
import { useTerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import type { SelectedBranchDetailPresentation } from '#/renderer/components/branch-detail/model.ts'

interface Props {
  repo: RepoState
  detail: SelectedBranchDetailPresentation
  detailId: string
  contentId: string
  collapsed: boolean
  focusMode: boolean
  layout: RepoWorkspaceLayout
}

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [role="tab"], [role="menuitem"]'

export function BranchDetailToolbar({ repo, detail, detailId, contentId, collapsed, focusMode, layout }: Props) {
  const t = useT()
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const toggleDetailCollapsed = useReposStore((s) => s.toggleDetailCollapsed)
  const toggleDetailFocusMode = useReposStore((s) => s.toggleDetailFocusMode)
  const shortcutsDisabled = useSettingsStore((s) => s.shortcutsDisabled)
  const terminalContext = useTerminalSessionContext()
  const behavior = repoWorkspaceBehavior(layout, collapsed, focusMode)
  const tabs = visibleDetailTabs(!!detail.branch?.worktreePath)
  const terminalCount = detail.branch?.worktreePath
    ? terminalContext.sessionSummaries(terminalSessionGroupKey(repo.id, detail.branch.worktreePath)).length
    : 0

  // No selected branch means there is no tab/action target; BranchDetailContent renders the empty state.
  if (!detail.branch) return null

  function handleToolbarClick(e: MouseEvent<HTMLDivElement>) {
    if (!(e.target instanceof Element)) return
    if (e.target.closest(INTERACTIVE_SELECTOR)) return
    toggleDetailCollapsed()
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, tabId: DetailTab) {
    const key = detailTabNavigationKey(e.key)
    if (!key) return
    e.preventDefault()
    const nextTab = navigatedDetailTab(tabId, key, !!detail.branch?.worktreePath)
    setDetailTab(repo.id, nextTab)
    setDetailCollapsed(false)
    // The tablist stays mounted even when the panel is collapsed; optional chaining guards transient unmounts.
    window.requestAnimationFrame(() => document.getElementById(`${detailId}-${nextTab}-tab`)?.focus())
  }

  return (
    <Toolbar variant="detail" onClick={behavior.detailCollapseAllowed ? handleToolbarClick : undefined}>
      {behavior.detailCollapseAllowed && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleDetailCollapsed}
          aria-label={t(collapsed ? 'branch-detail.expand' : 'branch-detail.collapse')}
          title={t(
            shortcutsDisabled
              ? collapsed
                ? 'branch-detail.expand'
                : 'branch-detail.collapse'
              : collapsed
                ? 'branch-detail.expand-title'
                : 'branch-detail.collapse-title',
          )}
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : contentId}
          className="size-7"
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
            'size-7',
            behavior.detailFocusMode &&
              'bg-accent text-accent-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
          )}
        >
          {behavior.detailFocusMode ? <Minimize2 /> : <Maximize2 />}
        </Button>
      )}
      <div className="flex shrink-0" role="tablist" aria-label={t('tab.branch-detail')}>
        {tabs.map((tab) => {
          const selected = repo.ui.detailTab === tab.id
          const visuallySelected = !collapsed && selected
          return (
            <button
              key={tab.id}
              id={`${detailId}-${tab.id}-tab`}
              type="button"
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
                'inline-flex h-9 items-center gap-1.5 px-3 text-sm border-b-2 -mb-px cursor-pointer transition-colors duration-100',
                visuallySelected
                  ? 'border-brand text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
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
            </button>
          )
        })}
      </div>
      <BranchActionBar
        key={`${repo.id}:${detail.branch.name}`}
        repo={repo}
        branch={detail.branch}
        variant={behavior.detailActionVariant}
      />
    </Toolbar>
  )
}
