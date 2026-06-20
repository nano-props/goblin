import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Toolbar } from '#/web/components/Layout.tsx'
import { cn } from '#/web/lib/cn.ts'
import { terminalLog } from '#/web/logger.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-store.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  WorkspacePaneViewStrip,
  EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY,
  createBranchWorkspacePaneTabItem,
  createWorktreeWorkspacePaneTabItem,
  isTerminalWorkspacePaneTabItem,
  isWorktreeWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
  type WorkspacePaneWorktreeTabItem,
} from '#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneViewOrderEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneViewSummary, TerminalSessionBase } from '#/web/components/terminal/types.ts'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import {
  BRANCH_LEVEL_WORKSPACE_PANE_VIEWS,
  branchWorkspacePaneViewCloseLabel,
  branchWorkspacePaneViewLabel,
  branchWorkspacePaneViewTooltip,
} from '#/web/components/branch-workspace/workspace-pane-views.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useEffectiveWorkspacePaneView } from '#/web/components/branch-workspace/useEffectiveWorkspacePaneView.ts'
import { useIsInitialSyncInFlight } from '#/web/stores/repo-sync.ts'
import { isWorktreeLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'

interface Props {
  repo: Pick<BranchWorkspaceRepo, 'id' | 'ui' | 'data'>
  detail: SelectedBranchWorkspacePresentation
  detailId: string
  contentId: string
  layout: RepoWorkspaceLayout
}

export function BranchWorkspaceToolbar({ repo, detail, detailId }: Props) {
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
  const worktreeWorkspacePaneViews = useMemo(
    () => worktreeSnapshot.workspacePaneViews.filter((tab) => isWorktreeLevelWorkspacePaneView(tab.type)),
    [worktreeSnapshot.workspacePaneViews],
  )
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

  const showWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (!isWorktreeWorkspacePaneTabItem(item)) {
        navigation.showRepoWorkspacePaneView(repo.id, item.branchViewType)
        return
      }
      if (item.view.type === 'terminal') {
        enterTerminalTab()
        selectTerminal(item.view.worktreeTerminalKey, item.view.key)
        return
      }
      navigation.showRepoWorkspacePaneView(repo.id, item.view.type)
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
  const workspacePaneTabItems = useMemo<WorkspacePaneTabItem[]>(
    () => [
      ...(showBranchLevelTabs
        ? BRANCH_LEVEL_WORKSPACE_PANE_VIEWS.map((tab) => {
            const label = t(tab.labelKey)
            return createBranchWorkspacePaneTabItem({
              type: tab.type,
              label,
              tooltip: label,
              panelId: `${detailId}-${tab.type}-panel`,
            })
          })
        : []),
      ...worktreeWorkspacePaneViews.map((tab) =>
        createWorktreeWorkspacePaneTabItem({
          view: tab,
          label: labelForWorkspacePaneView(tab),
          tooltip: tooltipForWorkspacePaneView(tab),
          closeLabel: closeLabelForWorkspacePaneView(tab),
          panelId: `${detailId}-${tab.type}-panel`,
        }),
      ),
    ],
    [
      closeLabelForWorkspacePaneView,
      detailId,
      labelForWorkspacePaneView,
      showBranchLevelTabs,
      t,
      tooltipForWorkspacePaneView,
      worktreeWorkspacePaneViews,
    ],
  )
  const activeTabIdentity = useMemo(() => {
    const activeItem = workspacePaneTabItems.find((item) => {
      if (effectiveTab === 'terminal') return isTerminalWorkspacePaneTabItem(item) && item.view.selected
      return item.type === effectiveTab
    })
    return activeItem?.identity ?? null
  }, [effectiveTab, workspacePaneTabItems])
  const handleSelectWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (
        isWorktreeWorkspacePaneTabItem(item) &&
        item.view.type === 'terminal' &&
        item.identity === activeTabIdentity
      ) {
        handleScrollToBottom(item.view.key)
        return
      }
      showWorkspacePaneTabItem(item)
    },
    [activeTabIdentity, handleScrollToBottom, showWorkspacePaneTabItem],
  )
  const handleCloseWorkspacePaneView = useCallback(
    (item: WorkspacePaneWorktreeTabItem) => {
      const nextItem = nextWorkspacePaneTabItemAfterClose(workspacePaneTabItems, item.identity)
      const isActive = activeTabIdentity === item.identity

      if (item.view.type === 'terminal') {
        if (!terminalBase) return
        closeTerminalByDescriptor(item.view.key, terminalBase)
      } else {
        if (!terminalWorktreeKey) return
        void closeWorkspacePaneView(terminalWorktreeKey, item.view.type)
      }

      if (isActive && nextItem) {
        showWorkspacePaneTabItem(nextItem)
      } else if (isActive) {
        navigation.showRepoWorkspacePaneView(repo.id, 'status')
      }
    },
    [
      activeTabIdentity,
      closeTerminalByDescriptor,
      closeWorkspacePaneView,
      navigation,
      repo.id,
      showWorkspacePaneTabItem,
      terminalBase,
      terminalWorktreeKey,
      workspacePaneTabItems,
    ],
  )

  // No selected branch means there is no tab/action target; BranchWorkspaceContent renders the empty state.
  if (!detail.branch) return null

  return (
    <Toolbar variant="detail">
      <div className="flex h-full min-w-0 items-center gap-1 overflow-hidden">
        {showBranchLevelTabs && (
          <WorkspacePaneViewStrip
            worktreeTerminalKey={terminalWorktreeKey}
            items={workspacePaneTabItems}
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
            onSelect={handleSelectWorkspacePaneTabItem}
            onScrollToBottom={handleScrollToBottom}
            onClose={handleCloseWorkspacePaneView}
            onReorder={handleReorderWorkspacePaneViewStrip}
            activateCrossScopeKeyboardNavigation
          />
        )}
      </div>
      <div aria-hidden="true" className={cn('min-w-2 flex-1 self-stretch', compact && 'hidden')} />
    </Toolbar>
  )
}

function nextWorkspacePaneTabItemAfterClose(
  items: WorkspacePaneTabItem[],
  closingIdentity: string,
): WorkspacePaneTabItem | null {
  const index = items.findIndex((item) => item.identity === closingIdentity)
  if (index === -1) return items[0] ?? null
  return items[index + 1] ?? items[index - 1] ?? null
}
