import { useCallback, useEffect, useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '#/web/stores/i18n.ts'
import { Toolbar } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { terminalLog } from '#/web/logger.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-store.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  WorkspacePaneViewStrip,
  EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY,
  createBranchWorkspacePaneTabItem,
  createWorktreeWorkspacePaneTabItem,
  isBranchWorkspacePaneTabItem,
  isTerminalWorkspacePaneTabItem,
  isWorktreeWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneBranchViewType, WorkspacePaneViewOrderEntry } from '#/shared/workspace-pane.ts'
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
import { useEffectiveWorkspacePaneView } from '#/web/components/branch-workspace/useEffectiveWorkspacePaneView.ts'
import { useIsInitialSyncInFlight } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { branchWorkspacePaneViewsForBranch } from '#/web/stores/repos/branch-workspace-pane-views.ts'
import { isBranchLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'

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
  const effectiveTab = useEffectiveWorkspacePaneView(repo)
  // T6.1: while the first server-side session list for this repo is
  // in flight, render skeleton placeholder chips in the tab strip.
  // Hooks into the existing repo-sync store which the Provider
  // updates via markReady() at the end of every syncServerSessions.
  const isInitialSyncInFlight = useIsInitialSyncInFlight(repo.id)
  const terminalWorktreeKey = detail.branch?.worktree?.path
    ? worktreeTerminalKey(repo.id, detail.branch.worktree.path)
    : null
  const branchName = detail.branch?.name ?? null
  const showBranchLevelTabs = !!detail.branch

  const {
    createTerminal,
    selectTerminal,
    scrollToBottom,
    closeTerminalByDescriptor,
    openWorkspacePaneView,
    closeWorkspacePaneView,
    reorderWorkspacePaneViews,
  } = useTerminalSessionContext()

  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const runtimeWorkspacePaneViews = worktreeSnapshot.workspacePaneViews
  const openBranchWorkspacePaneViews = useMemo(
    () => branchWorkspacePaneViewsForBranch(repo.ui, branchName),
    [branchName, repo.ui.openBranchWorkspacePaneViewsByBranch],
  )
  const openBranchLevelTabs = useMemo(
    () => branchLevelWorkspacePaneViewDefinitions(openBranchWorkspacePaneViews),
    [openBranchWorkspacePaneViews],
  )
  const worktreeWorkspacePaneViews = useMemo<WorkspacePaneViewSummary[]>(() => {
    if (!terminalWorktreeKey || !detail.branch?.worktree?.path) return runtimeWorkspacePaneViews
    const openBranchTypes = new Set(openBranchLevelTabs.map((tab) => tab.type))
    const runtimeBranchTypes = runtimeWorkspacePaneViews.flatMap((view) => {
      return isBranchLevelWorkspacePaneView(view.type) ? [view.type] : []
    })
    const hasSameBranchRuntimeSet =
      runtimeBranchTypes.length === openBranchTypes.size &&
      runtimeBranchTypes.every((type) => openBranchTypes.has(type))
    if (hasSameBranchRuntimeSet) return runtimeWorkspacePaneViews

    const runtimeBranchViewsByType = new Map(
      runtimeWorkspacePaneViews.flatMap((view) => {
        return isBranchLevelWorkspacePaneView(view.type) ? [[view.type, view] as const] : []
      }),
    )
    const branchStaticViews = openBranchLevelTabs.map((tab, index) => {
      const runtimeView = runtimeBranchViewsByType.get(tab.type)
      if (runtimeView) return runtimeView
      return {
        type: tab.type,
        id: tab.type,
        key: tab.type,
        worktreeTerminalKey: terminalWorktreeKey,
        worktreePath: detail.branch!.worktree!.path,
        displayOrder: index,
      }
    })
    return [
      ...branchStaticViews,
      ...runtimeWorkspacePaneViews.filter((view) => !isBranchLevelWorkspacePaneView(view.type)),
    ]
  }, [detail.branch, openBranchLevelTabs, runtimeWorkspacePaneViews, terminalWorktreeKey])
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
      const branchViews = orderedViews.map((entry) => entry.type).filter(isBranchLevelWorkspacePaneView)
      void reorderWorkspacePaneViews(worktreeKey, orderedViews).then((reordered) => {
        if (reordered && branchName && branchViews.length > 0) {
          useReposStore.getState().reorderBranchWorkspacePaneViews(repo.id, branchViews, branchName)
        }
      })
    },
    [branchName, reorderWorkspacePaneViews, repo.id],
  )
  const handleReorderBranchWorkspacePaneViewStrip = useCallback(
    (orderedViews: WorkspacePaneBranchViewType[]) => {
      useReposStore.getState().reorderBranchWorkspacePaneViews(repo.id, orderedViews, branchName ?? undefined)
    },
    [branchName, repo.id],
  )

  useEffect(() => {
    if (!terminalWorktreeKey) return
    for (const tab of openBranchLevelTabs) {
      if (runtimeWorkspacePaneViews.some((view) => view.type === tab.type)) continue
      void openWorkspacePaneView(terminalWorktreeKey, tab.type)
    }
  }, [openBranchLevelTabs, openWorkspacePaneView, runtimeWorkspacePaneViews, terminalWorktreeKey])

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
      ...(showBranchLevelTabs && !terminalWorktreeKey
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
      terminalWorktreeKey,
      t,
      tooltipForBranchLevelPaneView,
      tooltipForWorkspacePaneView,
      workspacePaneId,
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
    (item: WorkspacePaneTabItem) => {
      const nextItem = nextWorkspacePaneTabItemAfterClose(workspacePaneTabItems, item.identity)
      const isActive = activeTabIdentity === item.identity

      if (isBranchWorkspacePaneTabItem(item)) {
        if (!branchName) return
        useReposStore.getState().closeBranchWorkspacePaneView(repo.id, item.branchViewType, branchName)
      } else if (item.view.type === 'terminal') {
        if (!terminalBase) return
        closeTerminalByDescriptor(item.view.key, terminalBase)
      } else {
        const branchViewType = isBranchLevelWorkspacePaneView(item.view.type) ? item.view.type : null
        const currentRepo = useReposStore.getState().repos[repo.id]
        const previousBranchViews =
          branchViewType && currentRepo && branchName
            ? branchWorkspacePaneViewsForBranch(currentRepo.ui, branchName)
            : []
        if (branchViewType) {
          if (!branchName) return
          useReposStore.getState().closeBranchWorkspacePaneView(repo.id, branchViewType, branchName)
        }
        if (!terminalWorktreeKey) return
        void closeWorkspacePaneView(terminalWorktreeKey, item.view.type)
          .then((closed) => {
            if (!closed && branchViewType && branchName) {
              restoreBranchWorkspacePaneViews(repo.id, branchName, previousBranchViews)
            }
          })
          .catch((err) => {
            terminalLog.warn('failed to close workspace pane view', { err, type: item.view.type })
            if (branchViewType && branchName) restoreBranchWorkspacePaneViews(repo.id, branchName, previousBranchViews)
          })
      }

      if (isActive && nextItem) {
        showWorkspacePaneTabItem(nextItem)
      }
    },
    [
      activeTabIdentity,
      closeTerminalByDescriptor,
      closeWorkspacePaneView,
      branchName,
      repo.id,
      showWorkspacePaneTabItem,
      terminalBase,
      terminalWorktreeKey,
      workspacePaneTabItems,
    ],
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
            onReorderBranchViews={handleReorderBranchWorkspacePaneViewStrip}
            activateCrossScopeKeyboardNavigation
          />
        )}
      </div>
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

function branchLevelWorkspacePaneViewDefinitions(openViews: readonly WorkspacePaneBranchViewType[]) {
  return openViews.flatMap((type) => {
    const tab = branchLevelWorkspacePaneViewDefinition(type)
    return tab ? [tab] : []
  })
}

function restoreBranchWorkspacePaneViews(
  repoId: string,
  branchName: string,
  previousViews: WorkspacePaneBranchViewType[],
): void {
  if (previousViews.length === 0) return
  const store = useReposStore.getState()
  if (store.repos[repoId]?.ui.selectedBranch !== branchName) return
  for (const view of previousViews) {
    store.openBranchWorkspacePaneView(repoId, view, branchName)
  }
  store.reorderBranchWorkspacePaneViews(repoId, previousViews, branchName)
}
