import { useCallback, useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  WorkspacePaneTabStrip,
  EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY,
} from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import {
  createPendingWorkspacePaneTabItem,
  createStaticWorkspacePaneTabItem,
  createTerminalWorkspacePaneTabItem,
  isPendingWorkspacePaneTabItem,
  isStaticWorkspacePaneTabItem,
  isTerminalWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { RepoWorkspaceRepo, SelectedRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import type { RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useIsInitialSyncInFlight } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneTabForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import {
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
} from '#/web/components/workspace-pane/tab-providers.ts'
import { useWorkspacePaneTabDragPreview } from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarActions,
  WorkspaceToolbarContent,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { WorkspaceOpenExternallyMenu } from '#/web/components/repo-workspace/WorkspaceOpenExternallyMenu.tsx'
import type { BranchActions } from '#/web/hooks/useBranchActions.tsx'
import { useWorkspacePaneTabsReorderMutation } from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { orderWorkspacePaneItemsByTabEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface Props {
  repo: RepoWorkspaceRepo
  detail: SelectedRepoWorkspacePresentation
  workspacePaneId: string
  workspacePaneTabModel: RepoWorkspaceTabModel
  trafficLightOffset?: boolean
  branchActions?: BranchActions
}

export function RepoWorkspaceToolbar({
  repo,
  detail,
  workspacePaneId,
  workspacePaneTabModel,
  trafficLightOffset = false,
  branchActions,
}: Props) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const compact = useIsCompactUi()
  const clearSelectedBranch = useReposStore((s) => s.clearSelectedBranch)
  // While the first server-side session list for this repo is in flight,
  // keep the New Terminal affordance visible but busy. Hooks into the
  // repo-sync store which the Provider updates via markReady() at the end
  // of every syncServerSessions.
  const isInitialSyncInFlight = useIsInitialSyncInFlight(repo.id)
  const branchName = detail.branch?.name ?? null
  const preferredWorkspacePaneTab = preferredWorkspacePaneTabForBranch(repo.ui, branchName)
  const showBranchLevelTabs = !!detail.branch

  const { createTerminal, selectTerminal, scrollToBottom } = useTerminalSessionContext()

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
    if (preferredWorkspacePaneTab !== 'terminal') {
      navigation.showRepoWorkspacePaneTab(repo.id, 'terminal')
    }
  }, [navigation, repo.id, preferredWorkspacePaneTab])

  const handleNewTerminal = useCallback(() => {
    if (!terminalBase) return
    enterTerminalTab()
    void runCreateTerminalTabCommand({
      base: terminalBase,
      createTerminal,
      t,
    })
  }, [createTerminal, terminalBase, enterTerminalTab, t])

  const showWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isStaticWorkspacePaneTabItem(item)) {
        navigation.showRepoWorkspacePaneTab(repo.id, item.staticTabType)
        return
      }
      if (isTerminalWorkspacePaneTabItem(item)) {
        enterTerminalTab()
        selectTerminal(item.view.terminalWorktreeKey, item.view.terminalSessionId)
        return
      }
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

  const {
    visualTabs: visualWorkspacePaneTabs,
    stageDragPreview: stageWorkspacePaneTabDragPreview,
    clearDragPreview: clearWorkspacePaneTabDragPreview,
  } = useWorkspacePaneTabDragPreview({
    repoRoot: repo.id,
    branchName,
    worktreePath: terminalBase?.worktreePath ?? null,
    canonicalTabs: workspacePaneTabModel.tabEntries,
  })
  const { reorderTabs: reorderWorkspacePaneTabs } = useWorkspacePaneTabsReorderMutation({
    repoRoot: repo.id,
    branchName,
    worktreePath: terminalBase?.worktreePath ?? null,
    canonicalTabs: workspacePaneTabModel.tabEntries,
    onReorderRejected: clearWorkspacePaneTabDragPreview,
  })

  const handleReorderWorkspacePaneTabStrip = useCallback(
    (tabs: WorkspacePaneTabEntry[]) => {
      if (!stageWorkspacePaneTabDragPreview(tabs)) return
      reorderWorkspacePaneTabs(tabs)
    },
    [reorderWorkspacePaneTabs, stageWorkspacePaneTabDragPreview],
  )

  const canonicalWorkspacePaneTabItems = useMemo<WorkspacePaneTabItem[]>(
    () =>
      workspacePaneTabModel.tabs.map((tab) => {
        if (tab.kind === 'static') {
          const metadata = { t, branchName: branchName ?? '', statusCount: detail.statusCount }
          const type = tab.type as WorkspacePaneStaticTabType
          const provider = workspacePaneStaticTabProvider(type)
          return createStaticWorkspacePaneTabItem({
            type,
            label: provider.label(metadata),
            tooltip: provider.tooltip(metadata),
            closeLabel: provider.closeLabel(metadata),
            panelId: provider.panelId(workspacePaneId),
          })
        }
        if (tab.kind === 'pending') {
          const label = terminalWorkspacePaneTabProvider.pendingLabel({
            t,
            terminalCreatePending: workspacePaneTabModel.terminalCreatePending,
            terminalSyncReady: workspacePaneTabModel.terminalSyncReady,
          })
          return createPendingWorkspacePaneTabItem({
            type: tab.type,
            label,
            tooltip: label,
            panelId: terminalWorkspacePaneTabProvider.panelId(workspacePaneId),
          })
        }
        const metadata = {
          t,
          branchName: branchName ?? '',
          statusCount: detail.statusCount,
          view: tab.view,
        }
        return createTerminalWorkspacePaneTabItem({
          view: tab.view,
          label: terminalWorkspacePaneTabProvider.label(metadata),
          tooltip: terminalWorkspacePaneTabProvider.tooltip(metadata),
          closeLabel: terminalWorkspacePaneTabProvider.closeLabel(metadata),
          panelId: terminalWorkspacePaneTabProvider.panelId(workspacePaneId),
        })
      }),
    [
      branchName,
      detail.statusCount,
      t,
      workspacePaneTabModel.terminalCreatePending,
      workspacePaneTabModel.terminalSyncReady,
      workspacePaneTabModel.tabs,
      workspacePaneId,
    ],
  )
  const workspacePaneTabItems = useMemo<WorkspacePaneTabItem[]>(
    () =>
      orderWorkspacePaneItemsByTabEntries(
        canonicalWorkspacePaneTabItems,
        visualWorkspacePaneTabs,
        workspacePaneTabEntryForItem,
      ),
    [canonicalWorkspacePaneTabItems, visualWorkspacePaneTabs],
  )
  const activeTabIdentity = workspacePaneTabModel.activeTab?.identity ?? null
  const handleSelectWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      if (isTerminalWorkspacePaneTabItem(item) && item.identity === activeTabIdentity) {
        handleScrollToBottom(item.view.terminalSessionId)
        return
      }
      showWorkspacePaneTabItem(item)
    },
    [activeTabIdentity, handleScrollToBottom, showWorkspacePaneTabItem],
  )
  const handleCloseWorkspacePaneTab = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      void runCloseWorkspacePaneTabCommand({
        repoId: repo.id,
        targetIdentity: item.identity,
        navigation,
      })
    },
    [navigation, repo.id],
  )

  // No selected branch means there is no tab/action target; keep the
  // workspace chrome mounted so the right pane still contributes a
  // draggable top region.
  if (!detail.branch) {
    return (
      <WorkspaceToolbar draggable={!compact} trafficLightOffset={trafficLightOffset}>
        <WorkspaceToolbarLeadingSpacer reserve={trafficLightOffset} />
        <WorkspaceToolbarPrimary />
      </WorkspaceToolbar>
    )
  }

  const backLabel = t('workspace.back-to-branch-navigator')
  const handleBackToBranchNavigator = () => clearSelectedBranch(repo.id)
  const repoWorkspaceBackAction = compact ? (
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
    <WorkspaceToolbar draggable={!compact} trafficLightOffset={trafficLightOffset}>
      <WorkspaceToolbarLeadingSpacer reserve={trafficLightOffset} />
      <WorkspaceToolbarContent>
        <WorkspaceToolbarPrimary>
          {/* Compact UI only: back-to-branch-navigator is the user's escape hatch
              from the repo workspace. It must stay visible even when the tab
              strip below is empty, so it lives at the toolbar level rather than
              inside WorkspacePaneTabStrip's tab chrome. */}
          {compact && repoWorkspaceBackAction}
          {showBranchLevelTabs && (
            <WorkspacePaneTabStrip
              terminalWorktreeKey={workspacePaneTabModel.terminalWorktreeKey}
              items={workspacePaneTabItems}
              workspacePaneId={workspacePaneId}
              activeTabIdentity={activeTabIdentity}
              responsiveCompact={compact}
              panelActive
              focusRegistry={workspacePaneTabFocusRegistry}
              emptyFocusKey={EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY}
              // While a real terminal create is in flight, the tab model
              // contributes a pending terminal tab. Additional creates stay
              // disabled through the New Terminal affordance.
              newTerminalBusy={isInitialSyncInFlight || workspacePaneTabModel.terminalCreatePending}
              onNew={handleNewTerminal}
              onSelect={handleSelectWorkspacePaneTabItem}
              onScrollToBottom={handleScrollToBottom}
              onClose={handleCloseWorkspacePaneTab}
              onReorder={handleReorderWorkspacePaneTabStrip}
              activateKeyboardNavigationSelection
            />
          )}
        </WorkspaceToolbarPrimary>
        {detail.branch && (
          <WorkspaceToolbarActions data-workspace-toolbar-trailing-actions="">
            <WorkspaceOpenExternallyMenu repo={repo} branch={detail.branch} branchActions={branchActions!} />
          </WorkspaceToolbarActions>
        )}
      </WorkspaceToolbarContent>
    </WorkspaceToolbar>
  )
}

function workspacePaneTabEntryForItem(item: WorkspacePaneTabItem): WorkspacePaneTabEntry | null {
  return isPendingWorkspacePaneTabItem(item) ? null : item.tabEntry
}
