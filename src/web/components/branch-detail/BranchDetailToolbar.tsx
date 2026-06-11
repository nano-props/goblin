import { ArrowUp, Maximize2, Minimize2, Minus } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useCallback, useMemo } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { DetailTab, RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Badge } from '#/web/components/ui/badge.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { Toolbar } from '#/web/components/Layout.tsx'
import { detailTabNavigationKey, navigatedDetailTab, visibleDetailTabs } from '#/web/lib/detail-tabs.ts'
import { cn } from '#/web/lib/cn.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-store.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { EMPTY_TERMINAL_TAB_FOCUS_KEY, TerminalTabs } from '#/web/components/terminal/TerminalTabs.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { TerminalSessionBase } from '#/web/components/terminal/types.ts'
import type { BranchDetailRepo, SelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import { useRuntimeShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
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
}

export function BranchDetailToolbar({
  repo,
  detail,
  detailId,
  contentId,
  collapsed,
  detailFocusMode,
  layout,
}: Props) {
  const t = useT()
  const { setDetailCollapsed, toggleDetailCollapsed, toggleDetailFocusMode } = useStoreWithEqualityFn(
    useReposStore,
    branchDetailToolbarStoreActionsFromStore,
    branchDetailToolbarStoreActionsEqual,
  )
  const navigation = useMainWindowNavigation()
  const { shortcutsDisabled, toggleDetailOnActionBarBlankClick } = useRuntimeShortcutSettings()
  const compact = useIsCompactUi()
  const behavior = repoWorkspaceBehavior(layout, collapsed, detailFocusMode)
  const tabs = visibleDetailTabs(!!detail.branch?.worktree?.path)
  const terminalWorktreeKey = detail.branch?.worktree?.path ? worktreeTerminalKey(repo.id, detail.branch.worktree.path) : null

  const {
    createTerminal,
    selectTerminal,
    scrollToBottom,
    closeTerminalAndDismissDetailIfLast,
  } = useTerminalSessionContext()

  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSessions = worktreeSnapshot.sessions
  const detailTabFocusRegistry = useFocusRegistry<'status' | 'changes', HTMLButtonElement>()
  const terminalTabFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()

  const terminalBase = useMemo<TerminalSessionBase | null>(
    () =>
      detail.branch?.worktree?.path
        ? { repoRoot: repo.id, branch: detail.branch.name, worktreePath: detail.branch.worktree.path }
        : null,
    [repo.id, detail.branch],
  )

  const handleNewTerminal = useCallback(() => {
    if (!terminalBase) return
    if (repo.ui.detailTab !== 'terminal') {
      navigation.showRepoDetailTab(repo.id, 'terminal')
    }
    setDetailCollapsed(false)
    void createTerminal(terminalBase)
  }, [createTerminal, terminalBase, navigation, repo.id, repo.ui.detailTab, setDetailCollapsed])

  const handleSelectTerminal = useCallback(
    (worktreeKey: string, key: string) => {
      if (repo.ui.detailTab !== 'terminal') {
        navigation.showRepoDetailTab(repo.id, 'terminal')
      }
      setDetailCollapsed(false)
      selectTerminal(worktreeKey, key)
    },
    [repo.ui.detailTab, repo.id, navigation, selectTerminal, setDetailCollapsed],
  )

  const handleScrollToBottom = useCallback(
    (key: string) => {
      if (repo.ui.detailTab !== 'terminal') {
        navigation.showRepoDetailTab(repo.id, 'terminal')
      }
      setDetailCollapsed(false)
      scrollToBottom(key)
    },
    [repo.ui.detailTab, repo.id, navigation, scrollToBottom, setDetailCollapsed],
  )

  const handleCloseTerminal = useCallback(
    (key: string) => {
      if (!terminalBase) return
      closeTerminalAndDismissDetailIfLast(key, terminalBase)
    },
    [closeTerminalAndDismissDetailIfLast, terminalBase],
  )

  // No selected branch means there is no tab/action target; BranchDetailContent renders the empty state.
  if (!detail.branch) return null

  const focusedTerminalSession = terminalSessions.find((session) => session.selected) ?? terminalSessions[0] ?? null

  function focusTerminalTab() {
    terminalTabFocusRegistry.focus(focusedTerminalSession?.key ?? EMPTY_TERMINAL_TAB_FOCUS_KEY)
  }

  function focusDetailTab(tabId: 'status' | 'changes') {
    detailTabFocusRegistry.focus(tabId)
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, tabId: DetailTab) {
    const key = detailTabNavigationKey(e.key)
    if (!key) return
    e.preventDefault()
    const nextTab = navigatedDetailTab(tabId, key, !!detail.branch?.worktree?.path)
    navigation.showRepoDetailTab(repo.id, nextTab)
    setDetailCollapsed(false)
    if (nextTab === 'terminal') {
      focusTerminalTab()
      return
    }
    if (nextTab === 'status' || nextTab === 'changes') focusDetailTab(nextTab)
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
  const focusTogglePressed = behavior.detailFocusMode

  return (
    <Toolbar variant="detail">
      <div className="flex h-full min-w-0 items-center gap-1 overflow-hidden">
        <div className="flex h-full shrink-0 items-center gap-1" role="tablist" aria-label={t('tab.branch-detail')}>
          {tabs
            .filter((tab) => tab.id !== 'terminal')
            .map((tab) => {
              const tabId = tab.id === 'status' ? 'status' : 'changes'
              const selected = repo.ui.detailTab === tab.id
              const visuallySelected = !collapsed && selected
              return (
                <Button
                  key={tab.id}
                  ref={detailTabFocusRegistry.setRef(tabId)}
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
                  onKeyDown={(e) => handleTabKeyDown(e, tabId)}
                  className={cn(
                    'h-7 gap-1.5 border px-2.5 text-sm font-normal',
                    visuallySelected
                      ? 'border-transparent bg-selected text-selected-foreground'
                      : 'border-separator text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  {t(tab.labelKey)}
                  {tab.id === 'changes' && detail.statusCount > 0 && !compact && (
                    <Badge variant="attention" className="font-normal font-mono tabular-nums">
                      {detail.statusCount}
                    </Badge>
                  )}
                </Button>
              )
            })}
        </div>
        {terminalWorktreeKey && (
          <>
            <div className="mx-1 h-4 w-px bg-separator/70 self-center" aria-hidden="true" />
            <TerminalTabs
              worktreeTerminalKey={terminalWorktreeKey}
              sessions={terminalSessions}
              detailId={detailId}
              responsiveCompact={compact}
              panelActive={repo.ui.detailTab === 'terminal'}
              focusMode={detailFocusMode}
              focusRegistry={terminalTabFocusRegistry}
              emptyFocusKey={EMPTY_TERMINAL_TAB_FOCUS_KEY}
              onNew={handleNewTerminal}
              onSelect={handleSelectTerminal}
              onScrollToBottom={handleScrollToBottom}
              onClose={handleCloseTerminal}
              onNavigateOut={(direction) => {
                if (direction === 'first' || direction === 'next') {
                  navigation.showRepoDetailTab(repo.id, 'status')
                  setDetailCollapsed(false)
                  focusDetailTab('status')
                  return
                }
                if (direction === 'last') {
                  navigation.showRepoDetailTab(repo.id, 'terminal')
                  setDetailCollapsed(false)
                  focusTerminalTab()
                  return
                }
                navigation.showRepoDetailTab(repo.id, 'changes')
                setDetailCollapsed(false)
                focusDetailTab('changes')
              }}
            />
          </>
        )}
      </div>
      <div
        aria-hidden="true"
        className={cn('min-w-2 flex-1 self-stretch', compact && 'hidden')}
        onClick={behavior.detailCollapseAllowed && toggleDetailOnActionBarBlankClick ? toggleDetailCollapsed : undefined}
      />
      <div className="flex shrink-0 items-center gap-1">
        {layout === 'top-bottom' && <div className="mx-1 h-4 w-px bg-separator/70" aria-hidden="true" />}
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
            {collapsed ? <ArrowUp /> : <Minus />}
          </Button>
        )}
      </div>
    </Toolbar>
  )
}
