import { useCallback, useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  WorkspacePaneTabStrip,
  EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY,
} from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import {
  createPendingWorkspacePaneTabItem,
  createAgentWorkspacePaneTabItem,
  createStaticWorkspacePaneTabItem,
  createTerminalWorkspacePaneTabItem,
  isPendingWorkspacePaneTabItem,
  isAgentWorkspacePaneTabItem,
  isStaticWorkspacePaneTabItem,
  isTerminalWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { RepoWorkspaceRepo, CurrentRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import type { RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useIsInitialTerminalProjectionHydrating } from '#/web/stores/terminal-projection-hydration.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import { runCreateAgentTabCommand } from '#/web/commands/agent-create-command.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import {
  terminalWorkspacePaneTabProvider,
  agentWorkspacePaneTabProvider,
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
  detail: CurrentRepoWorkspacePresentation
  workspacePaneId: string
  workspacePaneTabModel: RepoWorkspaceTabModel
  trafficLightOffset?: boolean
  branchActions?: BranchActions
  onBackToBranchNavigator?: () => void
}

export function RepoWorkspaceToolbar({
  repo,
  detail,
  workspacePaneId,
  workspacePaneTabModel,
  trafficLightOffset = false,
  branchActions,
  onBackToBranchNavigator,
}: Props) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const compact = useIsCompactUi()
  const setSelectedAgent = useReposStore((s) => s.setSelectedAgent)
  // While the first server-side session list for this repo is in flight,
  // keep the New Terminal affordance visible but busy. Hooks into the
  // terminal projection readiness store which the Provider updates after a
  // successful server -> client terminal session projection hydrate.
  const isInitialSyncInFlight = useIsInitialTerminalProjectionHydrating(repo.id, repo.instanceId)
  const branchName = detail.branch?.name ?? null
  const workspacePaneTabTargetKey = branchName
    ? workspacePaneTabsTargetIdentityKey({
        repoRoot: repo.id,
        branchName,
        worktreePath: detail.branch?.worktree?.path ?? null,
      })
    : null
  const preferredWorkspacePaneTab = preferredWorkspacePaneTabForTarget(
    repo.ui,
    branchName ? { repoRoot: repo.id, branchName, worktreePath: detail.branch?.worktree?.path ?? null } : null,
  )
  const showBranchLevelTabs = !!detail.branch

  const { createTerminal, createOwnedTerminal, selectTerminal, scrollToBottom } = useTerminalSessionContext()

  const workspacePaneTabFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()

  const terminalBase = useMemo<TerminalSessionBase | null>(
    () =>
      detail.branch?.worktree?.path
        ? {
            repoRoot: repo.id,
            repoInstanceId: repo.instanceId,
            branch: detail.branch.name,
            worktreePath: detail.branch.worktree.path,
          }
        : null,
    [repo.id, repo.instanceId, detail.branch],
  )

  // Shared "enter the terminal view" effect for any terminal-targeting action:
  // set the user's preferred tab to terminal (when not already there) and
  // uncollapse the pane. Callers add their own follow-up command
  // (create/select/scroll). Whether the terminal view is *renderable*
  // (worktree + sessions) is decided at read time by
  // the shared workspace pane tab model — we only assert user intent here.
  const enterTerminalTab = useCallback(() => {
    if (preferredWorkspacePaneTab !== 'terminal') {
      if (branchName) navigation.showRepoBranchWorkspacePaneTab(repo.id, branchName, 'terminal')
    }
  }, [branchName, navigation, repo.id, preferredWorkspacePaneTab])

  const enterAgentTab = useCallback(() => {
    if (preferredWorkspacePaneTab !== 'agent') {
      navigation.showRepoWorkspacePaneTab(repo.id, 'agent')
    }
  }, [navigation, preferredWorkspacePaneTab, repo.id])

  const handleNewTerminal = useCallback(() => {
    if (!terminalBase) return
    // "+" is a generic entry → don't anchor; opener only drives close-back.
    const openerIdentity = captureWorkspacePaneActiveTabIdentity(repo.id, terminalBase.branch)
    void runCreateTerminalTabCommand({
      base: terminalBase,
      createTerminal,
      createOwnedTerminal,
      openerIdentity,
      enterTerminalTab,
      t,
    })
  }, [createOwnedTerminal, createTerminal, terminalBase, repo.id, enterTerminalTab, t])

  const handleNewAgent = useCallback(() => {
    if (!terminalBase) return
    const openerIdentity = captureWorkspacePaneActiveTabIdentity(repo.id)
    void runCreateAgentTabCommand({
      base: { ...terminalBase, repoInstanceId: repo.instanceId },
      openerIdentity,
      enterAgentTab,
      t,
    })
  }, [enterAgentTab, repo.id, repo.instanceId, terminalBase, t])

  const showWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isStaticWorkspacePaneTabItem(item)) {
        if (branchName) navigation.showRepoBranchWorkspacePaneTab(repo.id, branchName, item.staticTabType)
        return
      }
      if (isTerminalWorkspacePaneTabItem(item)) {
        enterTerminalTab()
        selectTerminal(item.view.terminalWorktreeKey, item.view.terminalSessionId)
        return
      }
      if (isAgentWorkspacePaneTabItem(item)) {
        if (workspacePaneTabModel.agentWorktreeKey) {
          setSelectedAgent(workspacePaneTabModel.agentWorktreeKey, item.view.agentSessionId)
        }
        enterAgentTab()
        return
      }
    },
    [
      branchName,
      enterAgentTab,
      enterTerminalTab,
      navigation,
      repo.id,
      selectTerminal,
      setSelectedAgent,
      workspacePaneTabModel.agentWorktreeKey,
    ],
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
    repoInstanceId: repo.instanceId,
    branchName,
    worktreePath: terminalBase?.worktreePath ?? null,
    canonicalTabs: workspacePaneTabModel.tabEntries,
  })
  const { reorderTabs: reorderWorkspacePaneTabs } = useWorkspacePaneTabsReorderMutation({
    repoRoot: repo.id,
    repoInstanceId: repo.instanceId,
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
            terminalProjectionPhase: workspacePaneTabModel.terminalProjectionPhase,
          })
          return createPendingWorkspacePaneTabItem({
            type: tab.type,
            label,
            tooltip: label,
            panelId: terminalWorkspacePaneTabProvider.panelId(workspacePaneId),
          })
        }
        if (tab.kind === 'agent') {
          const metadata = {
            t,
            branchName: branchName ?? '',
            statusCount: detail.statusCount,
            view: tab.view,
          }
          return createAgentWorkspacePaneTabItem({
            view: tab.view,
            label: agentWorkspacePaneTabProvider.label(metadata),
            tooltip: agentWorkspacePaneTabProvider.tooltip(metadata),
            closeLabel: agentWorkspacePaneTabProvider.closeLabel(metadata),
            panelId: agentWorkspacePaneTabProvider.panelId(workspacePaneId),
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
      workspacePaneTabModel.terminalProjectionPhase,
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
        branchName,
        targetIdentity: item.identity,
        navigation,
      })
    },
    [branchName, navigation, repo.id],
  )

  // No current branch means there is no tab/action target; keep the
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
  const repoWorkspaceBackAction = compact ? (
    <Tip label={backLabel}>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onBackToBranchNavigator}
        disabled={!onBackToBranchNavigator}
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
          {showBranchLevelTabs && workspacePaneTabTargetKey && (
            <WorkspacePaneTabStrip
              terminalWorktreeKey={workspacePaneTabModel.terminalWorktreeKey}
              workspacePaneTabTargetKey={workspacePaneTabTargetKey}
              items={workspacePaneTabItems}
              workspacePaneId={workspacePaneId}
              activeTabIdentity={activeTabIdentity}
              responsiveCompact={compact}
              panelActive
              focusRegistry={workspacePaneTabFocusRegistry}
              emptyFocusKey={EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY}
              // While a terminal create is in flight, the tab model contributes
              // a pending terminal tab. This is presentation only: create
              // intent still goes to the server, which is the lifecycle
              // authority and either accepts, serializes, or rejects it.
              newTerminalBusy={isInitialSyncInFlight || workspacePaneTabModel.terminalCreatePending}
              onNew={handleNewTerminal}
              onNewAgent={handleNewAgent}
              onSelect={handleSelectWorkspacePaneTabItem}
              onScrollToBottom={handleScrollToBottom}
              onClose={handleCloseWorkspacePaneTab}
              onReorder={handleReorderWorkspacePaneTabStrip}
              activateKeyboardNavigationSelection
            />
          )}
        </WorkspaceToolbarPrimary>
        {!compact && branchActions && (
          <WorkspaceToolbarActions data-workspace-toolbar-trailing-actions="">
            <WorkspaceOpenExternallyMenu repo={repo} branch={detail.branch} branchActions={branchActions} />
          </WorkspaceToolbarActions>
        )}
      </WorkspaceToolbarContent>
    </WorkspaceToolbar>
  )
}

function workspacePaneTabEntryForItem(item: WorkspacePaneTabItem): WorkspacePaneTabEntry | null {
  return isPendingWorkspacePaneTabItem(item) ? null : item.tabEntry
}
