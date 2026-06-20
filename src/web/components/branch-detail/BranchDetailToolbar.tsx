import { ArrowLeft } from 'lucide-react'
import { useCallback, useMemo } from 'react'
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
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneViewOrderEntry } from '#/shared/workspace-pane.ts'
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
  branchWorkspacePaneViewCloseLabel,
  branchWorkspacePaneViewLabel,
  branchWorkspacePaneViewTooltip,
} from '#/web/components/branch-detail/workspace-pane-views.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useEffectiveWorkspacePaneView } from '#/web/components/branch-detail/useEffectiveWorkspacePaneView.ts'
import { useIsInitialSyncInFlight } from '#/web/stores/repo-sync.ts'
interface Props {
  repo: Pick<BranchDetailRepo, 'id' | 'ui' | 'data'>
  detail: SelectedBranchDetailPresentation
  detailId: string
  contentId: string
  workspacePaneFocusMode: boolean
  layout: RepoWorkspaceLayout
  onBack?: () => void
}

export function BranchDetailToolbar({ repo, detail, detailId, workspacePaneFocusMode, onBack }: Props) {
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
  const activeTabIdentity = activeWorkspacePaneViewIdentity(worktreeSnapshot.workspacePaneViews, effectiveTab)
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
      const nextTab = nextWorkspacePaneViewAfterClose(worktreeSnapshot.workspacePaneViews, closingIdentity)
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
      worktreeSnapshot.workspacePaneViews,
    ],
  )

  const handleReorderWorkspacePaneViewStrip = useCallback(
    (worktreeKey: string, orderedViews: WorkspacePaneViewOrderEntry[]) => {
      void reorderWorkspacePaneViews(worktreeKey, orderedViews)
    },
    [reorderWorkspacePaneViews],
  )

  const labelForWorkspacePaneView = useCallback((tab: WorkspacePaneViewSummary) => branchWorkspacePaneViewLabel(tab, t), [t])
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

  function focusActiveWorkspacePaneView() {
    const key =
      effectiveTab === 'terminal' && focusedTerminalSession
        ? terminalWorkspacePaneViewIdentity(focusedTerminalSession.key)
        : effectiveTab === 'status' || effectiveTab === 'changes'
          ? staticWorkspacePaneViewIdentity(effectiveTab)
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
        {terminalWorktreeKey && (
          <WorkspacePaneViewStrip
            worktreeTerminalKey={terminalWorktreeKey}
            views={worktreeSnapshot.workspacePaneViews}
            detailId={detailId}
            activeTabIdentity={activeTabIdentity}
            responsiveCompact={compact}
            panelActive
            focusMode={workspacePaneFocusMode}
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
              if (direction === 'first' || direction === 'last') focusActiveWorkspacePaneView()
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
