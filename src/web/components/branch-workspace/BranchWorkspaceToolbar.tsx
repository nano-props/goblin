import { useCallback, useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '#/web/stores/i18n.ts'
import { Toolbar } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { terminalLog } from '#/web/logger.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import {
  useTerminalRepoSyncReady,
  useWorktreeTerminalSnapshot,
} from '#/web/components/terminal/terminal-session-store.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  WorkspacePaneViewStrip,
  EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY,
  createBranchWorkspacePaneTabItem,
  createWorktreeWorkspacePaneTabItem,
  isWorktreeWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneBranchViewType, WorkspacePaneWorktreeViewOrderEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneViewSummary, TerminalSessionBase } from '#/web/components/terminal/types.ts'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import {
  branchLevelWorkspacePaneViewDefinition,
  branchLevelWorkspacePaneViewCloseLabel,
  branchLevelWorkspacePaneViewLabel,
  branchLevelWorkspacePaneViewTooltip,
  branchWorkspacePaneViewCloseLabel,
  branchWorkspacePaneViewLabel,
  branchWorkspacePaneViewTooltip,
} from '#/web/components/branch-workspace/workspace-pane-views.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useIsInitialSyncInFlight } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { branchWorkspacePaneViewsForBranch } from '#/web/stores/repos/branch-workspace-pane-views.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { createBranchWorkspacePaneTabModel } from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'

interface Props {
  repo: Pick<BranchWorkspaceRepo, 'id' | 'ui' | 'data'>
  detail: SelectedBranchWorkspacePresentation
  workspacePaneId: string
}

export function BranchWorkspaceToolbar({ repo, detail, workspacePaneId }: Props) {
  const t = useT()
  const navigation = useMainWindowNavigation()
  const compact = useIsCompactUi()
  const clearSelectedBranch = useReposStore((s) => s.clearSelectedBranch)
  // While the first server-side session list for this repo is in flight,
  // keep the New Terminal affordance visible but busy. Hooks into the
  // repo-sync store which the Provider updates via markReady() at the end
  // of every syncServerSessions.
  const isInitialSyncInFlight = useIsInitialSyncInFlight(repo.id)
  const terminalWorktreeKey = detail.branch?.worktree?.path
    ? worktreeTerminalKey(repo.id, detail.branch.worktree.path)
    : null
  const branchName = detail.branch?.name ?? null
  const worktreePath = detail.branch?.worktree?.path ?? null
  const preferredWorkspacePaneView = preferredWorkspacePaneViewForBranch(repo.ui, branchName)
  const showBranchLevelTabs = !!detail.branch

  const { createTerminal, selectTerminal, scrollToBottom, reorderWorkspacePaneViews } = useTerminalSessionContext()

  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSyncReady = useTerminalRepoSyncReady(repo.id)
  const runtimeWorkspacePaneViews = worktreeSnapshot.workspacePaneViews
  const openBranchWorkspacePaneViews = useMemo(
    () => branchWorkspacePaneViewsForBranch(repo.ui, branchName),
    [branchName, repo.ui.openBranchWorkspacePaneViewsByBranch],
  )
  const workspacePaneTabModel = useMemo(
    () =>
      createBranchWorkspacePaneTabModel({
        repoId: repo.id,
        branchName,
        worktreePath,
        preferredView: preferredWorkspacePaneView,
        openBranchViews: openBranchWorkspacePaneViews,
        runtimeWorktreeViews: runtimeWorkspacePaneViews,
        terminalSessionCount: worktreeSnapshot.count,
        pendingCreate: worktreeSnapshot.pendingCreate,
        terminalSyncReady,
      }),
    [
      branchName,
      openBranchWorkspacePaneViews,
      repo.id,
      runtimeWorkspacePaneViews,
      preferredWorkspacePaneView,
      terminalSyncReady,
      worktreePath,
      worktreeSnapshot.count,
      worktreeSnapshot.pendingCreate,
    ],
  )
  const openBranchLevelTabs = useMemo(
    () => branchLevelWorkspacePaneViewDefinitions(workspacePaneTabModel.openBranchViews),
    [workspacePaneTabModel.openBranchViews],
  )
  const worktreeWorkspacePaneViews = workspacePaneTabModel.worktreeViews
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
  // the shared workspace pane tab model — we only assert user intent here.
  const enterTerminalTab = useCallback(() => {
    if (preferredWorkspacePaneView !== 'terminal') {
      navigation.showRepoWorkspacePaneView(repo.id, 'terminal')
    }
  }, [navigation, repo.id, preferredWorkspacePaneView])

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
    (worktreeKey: string, orderedViews: WorkspacePaneWorktreeViewOrderEntry[]) => {
      void reorderWorkspacePaneViews(worktreeKey, orderedViews)
    },
    [reorderWorkspacePaneViews],
  )
  const handleReorderBranchWorkspacePaneViewStrip = useCallback(
    (orderedViews: WorkspacePaneBranchViewType[]) => {
      useReposStore.getState().reorderBranchWorkspacePaneViews(repo.id, orderedViews, branchName ?? undefined)
    },
    [branchName, repo.id],
  )

  const labelForWorkspacePaneView = useCallback(
    (tab: WorkspacePaneViewSummary) => branchWorkspacePaneViewLabel(tab, t, detail.statusCount),
    [detail.statusCount, t],
  )
  const tooltipForWorkspacePaneView = useCallback(
    (tab: WorkspacePaneViewSummary) =>
      branchWorkspacePaneViewTooltip({
        tab,
        branchName: branchName ?? '',
        statusCount: detail.statusCount,
        t,
      }),
    [branchName, detail.statusCount, t],
  )
  const closeLabelForWorkspacePaneView = useCallback(
    (tab: WorkspacePaneViewSummary) => branchWorkspacePaneViewCloseLabel(tab, t),
    [t],
  )
  const tooltipForBranchLevelPaneView = useCallback(
    (tab: WorkspacePaneBranchViewType) =>
      branchLevelWorkspacePaneViewTooltip({
        tab,
        branchName: branchName ?? '',
        t,
      }),
    [branchName, t],
  )

  const workspacePaneTabItems = useMemo<WorkspacePaneTabItem[]>(
    () => [
      ...(showBranchLevelTabs
        ? openBranchLevelTabs.map((tab) => {
            const label = branchLevelWorkspacePaneViewLabel(tab.type, t)
            return createBranchWorkspacePaneTabItem({
              type: tab.type,
              label,
              tooltip: tooltipForBranchLevelPaneView(tab.type),
              closeLabel: branchLevelWorkspacePaneViewCloseLabel(tab.type, t),
              panelId: `${workspacePaneId}-${tab.type}-panel`,
            })
          })
        : []),
      ...worktreeWorkspacePaneViews.map((tab) =>
        createWorktreeWorkspacePaneTabItem({
          view: tab,
          label: labelForWorkspacePaneView(tab),
          tooltip: tooltipForWorkspacePaneView(tab),
          closeLabel: closeLabelForWorkspacePaneView(tab),
          panelId: `${workspacePaneId}-${tab.type}-panel`,
        }),
      ),
    ],
    [
      closeLabelForWorkspacePaneView,
      labelForWorkspacePaneView,
      openBranchLevelTabs,
      showBranchLevelTabs,
      t,
      tooltipForBranchLevelPaneView,
      tooltipForWorkspacePaneView,
      workspacePaneId,
      worktreeWorkspacePaneViews,
    ],
  )
  const activeTabIdentity = workspacePaneTabModel.activeTab?.identity ?? null
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
    (item: WorkspacePaneTabItem) => {
      void runCloseWorkspacePaneTabCommand({
        repoId: repo.id,
        targetIdentity: item.identity,
        navigation,
      })
    },
    [navigation, repo.id],
  )

  // No selected branch means there is no tab/action target; BranchWorkspaceContent renders the empty state.
  if (!detail.branch) return null

  const backLabel = t('workspace.back-to-branch-navigator')
  const handleBackToBranchNavigator = () => clearSelectedBranch(repo.id)
  const branchWorkspaceBackAction = compact ? (
    <Tip label={backLabel}>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleBackToBranchNavigator}
        aria-label={backLabel}
        title={backLabel}
      >
        <ArrowLeft size={14} />
      </Button>
    </Tip>
  ) : null

  return (
    <Toolbar variant="workspace">
      <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {showBranchLevelTabs && (
          <WorkspacePaneViewStrip
            worktreeTerminalKey={terminalWorktreeKey}
            items={workspacePaneTabItems}
            workspacePaneId={workspacePaneId}
            activeTabIdentity={activeTabIdentity}
            responsiveCompact={compact}
            panelActive
            leadingAction={branchWorkspaceBackAction}
            focusRegistry={workspacePaneTabFocusRegistry}
            emptyFocusKey={EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY}
            // While terminal sync/create is in flight, the New Terminal
            // button itself shows the busy state. The tab strip never
            // receives a pseudo loading tab.
            newTerminalBusy={isInitialSyncInFlight || worktreeSnapshot.pendingCreate}
            onNew={handleNewTerminal}
            onSelect={handleSelectWorkspacePaneTabItem}
            onScrollToBottom={handleScrollToBottom}
            onClose={handleCloseWorkspacePaneView}
            onReorder={handleReorderWorkspacePaneViewStrip}
            onReorderBranchViews={handleReorderBranchWorkspacePaneViewStrip}
            activateCrossScopeKeyboardNavigation
          />
        )}
      </div>
    </Toolbar>
  )
}

function branchLevelWorkspacePaneViewDefinitions(openViews: readonly WorkspacePaneBranchViewType[]) {
  return openViews.flatMap((type) => {
    const tab = branchLevelWorkspacePaneViewDefinition(type)
    return tab ? [tab] : []
  })
}
