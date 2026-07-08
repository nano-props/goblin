import { useCallback, useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import {
  WorkspacePaneTabStrip,
  EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY,
} from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import {
  createPendingWorkspacePaneTabItem,
  createRuntimeWorkspacePaneTabItem,
  createStaticWorkspacePaneTabItem,
  isPendingWorkspacePaneTabItem,
  isRuntimeWorkspacePaneTabItem,
  isStaticWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type {
  WorkspacePaneRuntimeTabType,
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import type { RepoWorkspaceRepo, CurrentRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import type { RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useIsInitialTerminalProjectionHydrating } from '#/web/stores/terminal-projection-hydration.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import {
  workspacePaneRuntimeTabProvider,
  workspacePaneStaticTabProvider,
} from '#/web/workspace-pane/tab-providers.ts'
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
import { reselectWorkspacePaneRuntimeTab } from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'
import { useWorkspacePaneRuntimeTabCreateAction } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-create-action.ts'
import { useWorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-action-context.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

interface Props {
  repo: RepoWorkspaceRepo
  detail: CurrentRepoWorkspacePresentation
  workspacePaneId: string
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  workspacePaneTabModel: RepoWorkspaceTabModel
  trafficLightOffset?: boolean
  branchActions?: BranchActions
  onBackToBranchNavigator?: () => void
}

export function RepoWorkspaceToolbar({
  repo,
  detail,
  workspacePaneId,
  workspacePaneRoute,
  workspacePaneTabModel,
  trafficLightOffset = false,
  branchActions,
  onBackToBranchNavigator,
}: Props) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const compact = useIsCompactUi()
  // While the first server-side runtime session list for this repo is in
  // flight, keep the runtime create affordance visible but busy. The current
  // signal comes from terminal projection hydration until more runtime tab
  // providers exist.
  const isInitialRuntimeProjectionHydrating = useIsInitialTerminalProjectionHydrating(repo.id, repo.instanceId)
  const branchName = detail.branch?.name ?? null
  const worktreePath = detail.branch?.worktree?.path ?? null
  const workspacePaneTabTargetKey = branchName
    ? workspacePaneTabsTargetIdentityKey({
        repoRoot: repo.id,
        branchName,
        worktreePath,
      })
    : null
  const showBranchLevelTabs = !!detail.branch

  const workspacePaneTabFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()

  const showCreatedWorkspacePaneRuntimeTab = useCallback(
    (type: WorkspacePaneRuntimeTabType, sessionId: string) => {
      if (!branchName) return false
      if (type === 'terminal') return navigation.showRepoBranchTerminalSession(repo.id, branchName, sessionId)
      return false
    },
    [branchName, navigation, repo.id],
  )
  const workspacePaneRuntimeTabActionContext = useWorkspacePaneRuntimeTabActionContext({
    showRuntimeTab: showCreatedWorkspacePaneRuntimeTab,
  })
  const workspacePaneCreateAction = useWorkspacePaneRuntimeTabCreateAction({
    repoRoot: repo.id,
    repoInstanceId: repo.instanceId,
    branchName,
    worktreePath,
    runtimeTabStateByType: workspacePaneTabModel.runtimeTabStateByType,
    initialRuntimeProjectionHydrating: isInitialRuntimeProjectionHydrating,
    workspacePaneRoute,
    showCreatedRuntimeTab: showCreatedWorkspacePaneRuntimeTab,
    t,
  })

  const showWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isStaticWorkspacePaneTabItem(item)) {
        if (branchName) navigation.showRepoBranchWorkspacePaneTab(repo.id, branchName, item.staticTabType)
        return
      }
      if (isRuntimeWorkspacePaneTabItem(item)) {
        if (branchName) navigation.showRepoBranchTerminalSession(repo.id, branchName, item.tabEntry.runtimeSessionId)
      }
    },
    [branchName, navigation, repo.id],
  )

  const reselectWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isRuntimeWorkspacePaneTabItem(item)) {
        reselectWorkspacePaneRuntimeTab(item.view, workspacePaneRuntimeTabActionContext)
        return
      }
      showWorkspacePaneTabItem(item)
    },
    [showWorkspacePaneTabItem, workspacePaneRuntimeTabActionContext],
  )

  const {
    visualTabs: visualWorkspacePaneTabs,
    stageDragPreview: stageWorkspacePaneTabDragPreview,
    clearDragPreview: clearWorkspacePaneTabDragPreview,
  } = useWorkspacePaneTabDragPreview({
    repoRoot: repo.id,
    repoInstanceId: repo.instanceId,
    branchName,
    worktreePath,
    canonicalTabs: workspacePaneTabModel.tabEntries,
  })
  const { reorderTabs: reorderWorkspacePaneTabs } = useWorkspacePaneTabsReorderMutation({
    repoRoot: repo.id,
    repoInstanceId: repo.instanceId,
    branchName,
    worktreePath,
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
          const provider = workspacePaneRuntimeTabProvider(tab.runtimeType)
          const runtimeState = workspacePaneTabModel.runtimeTabStateByType[tab.runtimeType]
          const label = provider.pendingLabel({
            t,
            createPending: runtimeState.createPending,
            projectionPhase: runtimeState.projectionPhase,
          })
          return createPendingWorkspacePaneTabItem({
            type: tab.type,
            label,
            tooltip: label,
            panelId: provider.panelId(workspacePaneId),
          })
        }
        const provider = workspacePaneRuntimeTabProvider(tab.runtimeType)
        const metadata = {
          t,
          branchName: branchName ?? '',
          statusCount: detail.statusCount,
          view: tab.view,
        }
        return createRuntimeWorkspacePaneTabItem({
          view: tab.view,
          label: provider.label(metadata),
          tooltip: provider.tooltip(metadata),
          closeLabel: provider.closeLabel(metadata),
          panelId: provider.panelId(workspacePaneId),
        })
      }),
    [
      branchName,
      detail.statusCount,
      t,
      workspacePaneTabModel.runtimeTabStateByType,
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
  const activeTabIdentity = workspacePaneTabModel.activeTab?.identity ?? activePendingTabIdentity(workspacePaneTabModel)
  const handleSelectWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      showWorkspacePaneTabItem(item)
    },
    [showWorkspacePaneTabItem],
  )
  const handleReselectWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      reselectWorkspacePaneTabItem(item)
    },
    [reselectWorkspacePaneTabItem],
  )
  const handleCloseWorkspacePaneTab = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      void runCloseWorkspacePaneTabCommand({
        repoId: repo.id,
        branchName,
        workspacePaneRoute,
        targetIdentity: item.identity,
        navigation,
      })
    },
    [branchName, navigation, repo.id, workspacePaneRoute],
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
              workspacePaneTabTargetKey={workspacePaneTabTargetKey}
              items={workspacePaneTabItems}
              workspacePaneId={workspacePaneId}
              activeTabIdentity={activeTabIdentity}
              responsiveCompact={compact}
              panelActive
              focusRegistry={workspacePaneTabFocusRegistry}
              emptyFocusKey={EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY}
              // While a runtime create is in flight, the tab model contributes
              // a pending runtime tab. This is presentation only: create
              // intent still goes to the server, which is the lifecycle
              // authority and either accepts, serializes, or rejects it.
              createAction={workspacePaneCreateAction}
              onSelect={handleSelectWorkspacePaneTabItem}
              onReselect={handleReselectWorkspacePaneTabItem}
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

function activePendingTabIdentity(model: RepoWorkspaceTabModel): string | null {
  const selection = model.selection
  if (selection?.kind !== 'runtime-host') return null
  const runtimeType = selection.runtimeType
  return model.tabs.find((tab) => tab.kind === 'pending' && tab.runtimeType === runtimeType)?.identity ?? null
}
