import { ArrowLeft, GitBranch } from 'lucide-react'
import { useCallback, useMemo, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { Toolbar } from '#/web/components/Layout.tsx'
import { cn } from '#/web/lib/cn.ts'
import { terminalLog } from '#/web/logger.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-store.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { WorkspacePaneViewStrip, EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY } from '#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { ToolbarTabList } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import {
  toolbarTabButtonClassName,
  toolbarTabChromeClassName,
  toolbarTabIconClassName,
} from '#/web/components/tab-strip/tab-variants.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneView, WorkspacePaneViewOrderEntry } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneViewSummary,
  TerminalSessionBase,
} from '#/web/components/terminal/types.ts'
import {
  activeWorkspacePaneViewIdentity,
  workspacePaneViewIdentity,
  nextWorkspacePaneViewAfterClose,
  staticWorkspacePaneViewIdentity,
  terminalWorkspacePaneViewIdentity,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { BranchDetailRepo, SelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import {
  BRANCH_LEVEL_WORKSPACE_PANE_VIEWS,
  branchLevelWorkspacePaneViewButtonId,
  branchWorkspacePaneViewCloseLabel,
  branchWorkspacePaneViewLabel,
  branchWorkspacePaneViewTooltip,
} from '#/web/components/branch-detail/workspace-pane-views.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useEffectiveWorkspacePaneView } from '#/web/components/branch-detail/useEffectiveWorkspacePaneView.ts'
import { useIsInitialSyncInFlight } from '#/web/stores/repo-sync.ts'
import {
  isWorktreeLevelWorkspacePaneView,
  type BranchLevelWorkspacePaneView,
} from '#/web/lib/workspace-pane-view.ts'

interface Props {
  repo: Pick<BranchDetailRepo, 'id' | 'ui' | 'data'>
  detail: SelectedBranchDetailPresentation
  detailId: string
  contentId: string
  layout: RepoWorkspaceLayout
  onBack?: () => void
}

export function BranchDetailToolbar({ repo, detail, detailId, onBack }: Props) {
  const t = useT()
  const navigation = useMainWindowNavigation()
  const compact = useIsCompactUi()
  const effectiveTab = useEffectiveWorkspacePaneView(repo)
  // T6.1: while the first server-side session list for this repo is
  // in flight, render skeleton placeholder chips in the tab strip.
  // Hooks into the existing repo-sync store which the Provider
  // updates via markReady() at the end of every syncServerSessions.
  const isInitialSyncInFlight = useIsInitialSyncInFlight(repo.id)
  const terminalWorktreeKey = detail.branch?.worktree?.path
    ? worktreeTerminalKey(repo.id, detail.branch.worktree.path)
    : null
  const showBranchLevelTabs = !!detail.branch

  const {
    createTerminal,
    selectTerminal,
    scrollToBottom,
    closeTerminalByDescriptor,
    closeWorkspacePaneView,
    reorderWorkspacePaneViews,
  } = useTerminalSessionContext()

  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSessions = worktreeSnapshot.sessions
  const worktreeWorkspacePaneViews = useMemo(
    () => worktreeSnapshot.workspacePaneViews.filter((tab) => isWorktreeLevelWorkspacePaneView(tab.type)),
    [worktreeSnapshot.workspacePaneViews],
  )
  const activeTabIdentity = activeWorkspacePaneViewIdentity(worktreeWorkspacePaneViews, effectiveTab)
  const workspacePaneTabFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()

  const terminalBase = useMemo<TerminalSessionBase | null>(
    () =>
      detail.branch?.worktree?.path
        ? { repoRoot: repo.id, branch: detail.branch.name, worktreePath: detail.branch.worktree.path }
        : null,
    [repo.id, detail.branch],
  )

  // Shared "enter the terminal view" effect for any terminal-targeting action:
  // set the user's preferred tab to terminal (when not already there) and
  // uncollapse the pane. Callers add their own follow-up command
  // (create/select/scroll). Whether the terminal view is *renderable*
  // (worktree + sessions) is decided at read time by
  // `useEffectiveWorkspacePaneView` — we only assert user intent here.
  const enterTerminalTab = useCallback(() => {
    if (repo.ui.preferredWorkspacePaneView !== 'terminal') {
      navigation.showRepoWorkspacePaneView(repo.id, 'terminal')
    }
  }, [navigation, repo.id, repo.ui.preferredWorkspacePaneView])

  const handleNewTerminal = useCallback(() => {
    if (!terminalBase) return
    enterTerminalTab()
    void createTerminal(terminalBase).catch((err) => {
      terminalLog.warn('failed to create terminal', { err })
      const message = err instanceof Error ? err.message : 'error.terminal-create-failed'
      toast.error(t('action.result-error'), { description: t(message) })
    })
  }, [createTerminal, terminalBase, enterTerminalTab, t])

  const handleSelectWorkspacePaneView = useCallback(
    (worktreeKey: string, tab: WorkspacePaneViewSummary) => {
      if (tab.type === 'terminal') {
        enterTerminalTab()
        selectTerminal(worktreeKey, tab.key)
        return
      }
      navigation.showRepoWorkspacePaneView(repo.id, tab.type)
    },
    [enterTerminalTab, navigation, repo.id, selectTerminal],
  )

  const handleScrollToBottom = useCallback(
    (key: string) => {
      enterTerminalTab()
      scrollToBottom(key)
    },
    [enterTerminalTab, scrollToBottom],
  )

  const handleCloseWorkspacePaneView = useCallback(
    (tab: WorkspacePaneViewSummary) => {
      const closingIdentity = workspacePaneViewIdentity(tab)
      const nextTab = nextWorkspacePaneViewAfterClose(worktreeWorkspacePaneViews, closingIdentity)
      const isActive = activeTabIdentity === closingIdentity

      if (tab.type === 'terminal') {
        if (!terminalBase) return
        closeTerminalByDescriptor(tab.key, terminalBase)
      } else {
        if (!terminalWorktreeKey) return
        void closeWorkspacePaneView(terminalWorktreeKey, tab.type)
      }

      if (isActive && nextTab) {
        if (nextTab.type === 'terminal') {
          navigation.showRepoWorkspacePaneView(repo.id, 'terminal')
          selectTerminal(nextTab.worktreeTerminalKey, nextTab.key)
        } else {
          navigation.showRepoWorkspacePaneView(repo.id, nextTab.type)
        }
      } else if (isActive) {
        navigation.showRepoWorkspacePaneView(repo.id, 'status')
      }
    },
    [
      activeTabIdentity,
      closeWorkspacePaneView,
      closeTerminalByDescriptor,
      navigation,
      repo.id,
      selectTerminal,
      terminalBase,
      terminalWorktreeKey,
      worktreeWorkspacePaneViews,
    ],
  )

  const handleReorderWorkspacePaneViewStrip = useCallback(
    (worktreeKey: string, orderedViews: WorkspacePaneViewOrderEntry[]) => {
      void reorderWorkspacePaneViews(worktreeKey, orderedViews)
    },
    [reorderWorkspacePaneViews],
  )

  const labelForWorkspacePaneView = useCallback(
    (tab: WorkspacePaneViewSummary) => branchWorkspacePaneViewLabel(tab, t, detail.statusCount),
    [detail.statusCount, t],
  )
  const tooltipForWorkspacePaneView = useCallback(
    (tab: WorkspacePaneViewSummary) =>
      branchWorkspacePaneViewTooltip({
        tab,
        branchName: detail.branch?.name ?? '',
        statusCount: detail.statusCount,
        t,
      }),
    [detail.branch?.name, detail.statusCount, t],
  )
  const closeLabelForWorkspacePaneView = useCallback(
    (tab: WorkspacePaneViewSummary) => branchWorkspacePaneViewCloseLabel(tab, t),
    [t],
  )

  // No selected branch means there is no tab/action target; BranchDetailContent renders the empty state.
  if (!detail.branch) return null

  const focusedTerminalSession = terminalSessions.find((session) => session.selected) ?? terminalSessions[0] ?? null

  function focusBranchLevelTab(type: BranchLevelWorkspacePaneView = 'status') {
    workspacePaneTabFocusRegistry.focus(staticWorkspacePaneViewIdentity(type))
  }

  function focusWorktreeWorkspacePaneView(tab: WorkspacePaneViewSummary | null) {
    if (!tab) {
      workspacePaneTabFocusRegistry.focus(EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY)
      return
    }
    workspacePaneTabFocusRegistry.focus(workspacePaneViewIdentity(tab))
  }

  function selectWorktreeWorkspacePaneView(tab: WorkspacePaneViewSummary | null) {
    if (!tab) {
      focusWorktreeWorkspacePaneView(null)
      return
    }
    handleSelectWorkspacePaneView(tab.worktreeTerminalKey, tab)
    focusWorktreeWorkspacePaneView(tab)
  }

  function handleBranchLevelTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, type: BranchLevelWorkspacePaneView) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const branchTabs = BRANCH_LEVEL_WORKSPACE_PANE_VIEWS
    const index = branchTabs.findIndex((tab) => tab.type === type)
    const hasWorktreeViews = !!terminalWorktreeKey

    if (e.key === 'Home') {
      const firstBranchTab = branchTabs[0]?.type ?? 'status'
      navigation.showRepoWorkspacePaneView(repo.id, firstBranchTab)
      focusBranchLevelTab(firstBranchTab)
      return
    }
    if (e.key === 'End') {
      if (hasWorktreeViews) {
        selectWorktreeWorkspacePaneView(worktreeWorkspacePaneViews[worktreeWorkspacePaneViews.length - 1] ?? null)
        return
      }
      const lastBranchTab = branchTabs[branchTabs.length - 1]?.type ?? 'status'
      navigation.showRepoWorkspacePaneView(repo.id, lastBranchTab)
      focusBranchLevelTab(lastBranchTab)
      return
    }

    const direction = e.key === 'ArrowRight' ? 1 : -1
    const nextBranchTab = branchTabs[index + direction]
    if (nextBranchTab) {
      navigation.showRepoWorkspacePaneView(repo.id, nextBranchTab.type)
      focusBranchLevelTab(nextBranchTab.type)
      return
    }
    if (hasWorktreeViews) {
      selectWorktreeWorkspacePaneView(
        direction === 1
          ? (worktreeWorkspacePaneViews[0] ?? null)
          : (worktreeWorkspacePaneViews[worktreeWorkspacePaneViews.length - 1] ?? null),
      )
    }
  }

  function focusActiveWorkspacePaneView() {
    const key =
      effectiveTab === 'terminal' && focusedTerminalSession
        ? terminalWorkspacePaneViewIdentity(focusedTerminalSession.key)
        : effectiveTab === 'status'
          ? staticWorkspacePaneViewIdentity(effectiveTab)
          : effectiveTab === 'changes'
            ? (activeTabIdentity ?? EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY)
          : EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY
    workspacePaneTabFocusRegistry.focus(key)
  }

  return (
    <Toolbar variant="detail">
      <div className="flex h-full min-w-0 items-center gap-1 overflow-hidden">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label={t('workspace.compact-back')}
            title={t('workspace.compact-back')}
            className="shrink-0"
          >
            <ArrowLeft />
          </Button>
        )}
        {onBack && (terminalWorktreeKey || showBranchLevelTabs) && (
          <div aria-hidden="true" className="h-5 w-px shrink-0 bg-separator" />
        )}
        {showBranchLevelTabs && (
          <BranchLevelWorkspacePaneTabs
            detailId={detailId}
            activeView={effectiveTab}
            focusRegistry={workspacePaneTabFocusRegistry}
            onSelect={(type) => navigation.showRepoWorkspacePaneView(repo.id, type)}
            onKeyDown={handleBranchLevelTabKeyDown}
          />
        )}
        {terminalWorktreeKey && (
          <WorkspacePaneViewStrip
            worktreeTerminalKey={terminalWorktreeKey}
            views={worktreeWorkspacePaneViews}
            detailId={detailId}
            activeTabIdentity={activeTabIdentity}
            responsiveCompact={compact}
            panelActive
            focusRegistry={workspacePaneTabFocusRegistry}
            emptyFocusKey={EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY}
            // T6.1: while the first server-side session list is in
            // flight (mount or repo switch), show a single placeholder
            // chip instead of the lone "+ New" button — the user gets
            // a visible signal that the strip is loading, not broken.
            isLoading={isInitialSyncInFlight}
            onNew={handleNewTerminal}
            onSelect={handleSelectWorkspacePaneView}
            onScrollToBottom={handleScrollToBottom}
            onClose={handleCloseWorkspacePaneView}
            onReorder={handleReorderWorkspacePaneViewStrip}
            getLabel={labelForWorkspacePaneView}
            getTooltip={tooltipForWorkspacePaneView}
            getCloseLabel={closeLabelForWorkspacePaneView}
            onNavigateOut={(direction) => {
              if (direction === 'prev' || direction === 'first' || direction === 'next') {
                navigation.showRepoWorkspacePaneView(repo.id, 'status')
                focusBranchLevelTab('status')
                return
              }
              if (direction === 'last') focusActiveWorkspacePaneView()
            }}
          />
        )}
      </div>
      <div
        aria-hidden="true"
        className={cn('min-w-2 flex-1 self-stretch', compact && 'hidden')}
      />
    </Toolbar>
  )
}

function BranchLevelWorkspacePaneTabs({
  detailId,
  activeView,
  focusRegistry,
  onSelect,
  onKeyDown,
}: {
  detailId: string
  activeView: WorkspacePaneView
  focusRegistry: ReturnType<typeof useFocusRegistry<string, HTMLButtonElement>>
  onSelect: (type: BranchLevelWorkspacePaneView) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, type: BranchLevelWorkspacePaneView) => void
}) {
  const t = useT()

  return (
    <ToolbarTabList role="tablist" aria-label={t('workspace-pane-views.tabs')} aria-orientation="horizontal">
      {BRANCH_LEVEL_WORKSPACE_PANE_VIEWS.map((tab) => {
        const active = activeView === tab.type
        const label = t(tab.labelKey)
        return (
          <ToolbarClosableTab
            key={tab.type}
            containerClassName={toolbarTabChromeClassName({ variant: 'detail', active })}
            buttonRef={focusRegistry.setRef(staticWorkspacePaneViewIdentity(tab.type))}
            buttonProps={{
              role: 'tab',
              id: branchLevelWorkspacePaneViewButtonId(detailId, tab.type),
              'aria-selected': active,
              'aria-controls': `${detailId}-${tab.type}-panel`,
              'aria-label': label,
              tabIndex: active ? 0 : -1,
              onClick: () => onSelect(tab.type),
              onKeyDown: (event) => onKeyDown(event, tab.type),
            }}
            buttonClassName={toolbarTabButtonClassName('detail')}
            closeButton={false}
            closeLabel={t('workspace-pane-views.close-named', { name: label })}
            closeVisible={false}
            onClose={() => {}}
          >
            <GitBranch size={13} className={toolbarTabIconClassName(active)} />
            <span className="truncate">{label}</span>
          </ToolbarClosableTab>
        )
      })}
    </ToolbarTabList>
  )
}
