import { useCallback, useMemo } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import {
  isPendingWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneRuntimeTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { RepoWorkspaceRepo, CurrentRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import type { RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useIsInitialTerminalProjectionHydrating } from '#/web/stores/terminal-projection-hydration.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { showCreatedTerminalWorkspacePaneRuntimeTab } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { useWorkspacePaneTabDragPreview } from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { WorkspacePaneToolbar } from '#/web/components/workspace-pane/WorkspacePaneToolbar.tsx'
import { WorkspaceOpenExternallyMenu } from '#/web/components/repo-workspace/WorkspaceOpenExternallyMenu.tsx'
import type { BranchActions } from '#/web/hooks/useBranchActions.tsx'
import { useWorkspacePaneTabsReorderMutation } from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { orderWorkspacePaneItemsByTabEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { dispatchSelectWorkspacePaneTabByIdentityAction } from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import { useWorkspacePaneRuntimeTabCreateAction } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-create-action.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { useWorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-action-context.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import {
  workspacePaneTabEntryForItem,
  workspacePaneTabItems as buildWorkspacePaneTabItems,
} from '#/web/components/repo-workspace/workspace-pane-tab-items.ts'

interface Props {
  repo: RepoWorkspaceRepo
  detail: CurrentRepoWorkspacePresentation
  workspacePaneId: string
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
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
  const isInitialRuntimeProjectionHydrating = useIsInitialTerminalProjectionHydrating(repo.id, repo.repoRuntimeId)
  const branchName = detail.branch?.name ?? null
  const worktreePath = detail.branch?.worktree?.path ?? null
  const workspacePaneTabTargetKey = branchName
    ? workspacePaneTabsTargetIdentityKey({
        repoRoot: repo.id,
        branchName,
        worktreePath,
      })
    : null
  const showCreatedWorkspacePaneRuntimeTab = useCallback(
    (
      type: WorkspacePaneRuntimeTabType,
      sessionId: string,
      canonicalBranch: string,
      target: RuntimeWorkspacePaneTarget,
    ) => {
      if (type === 'terminal' && worktreePath) {
        return showCreatedTerminalWorkspacePaneRuntimeTab(
          { repoRoot: repo.id, repoRuntimeId: repo.repoRuntimeId, branch: canonicalBranch, worktreePath, target },
          sessionId,
          navigation,
        )
      }
      return false
    },
    [navigation, repo.id, repo.repoRuntimeId, worktreePath],
  )
  const showWorkspacePaneRuntimeTab = useCallback(
    (type: WorkspacePaneRuntimeTabType, sessionId: string) => {
      if (!branchName || type !== 'terminal') return false
      return navigation.showRepoBranchTerminalSession(repo.id, branchName, sessionId)
    },
    [branchName, navigation, repo.id],
  )
  const workspacePaneRuntimeTabActionContext = useWorkspacePaneRuntimeTabActionContext({
    showRuntimeTab: showWorkspacePaneRuntimeTab,
  })
  const workspacePaneCreateAction = useWorkspacePaneRuntimeTabCreateAction({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
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
      void dispatchSelectWorkspacePaneTabByIdentityAction({
        repoId: repo.id,
        branchName,
        workspacePaneRoute,
        identity: item.identity,
        navigation,
        runtimeActionContext: workspacePaneRuntimeTabActionContext,
      })
    },
    [branchName, navigation, repo.id, workspacePaneRoute, workspacePaneRuntimeTabActionContext],
  )

  const reselectWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      void dispatchSelectWorkspacePaneTabByIdentityAction({
        repoId: repo.id,
        branchName,
        workspacePaneRoute,
        identity: item.identity,
        navigation,
        runtimeActionContext: workspacePaneRuntimeTabActionContext,
        reselect: true,
      })
    },
    [branchName, navigation, repo.id, workspacePaneRoute, workspacePaneRuntimeTabActionContext],
  )

  const {
    visualTabs: visualWorkspacePaneTabs,
    stageDragPreview: stageWorkspacePaneTabDragPreview,
    clearDragPreview: clearWorkspacePaneTabDragPreview,
  } = useWorkspacePaneTabDragPreview({
    ...(branchName
      ? { branchName, worktreePath }
      : { kind: 'inactive' as const, branchName: null, worktreePath: null }),
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    canonicalTabs: workspacePaneTabModel.tabEntries,
  })
  const { reorderTabs: reorderWorkspacePaneTabs } = useWorkspacePaneTabsReorderMutation({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
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
      buildWorkspacePaneTabItems({
        model: workspacePaneTabModel,
        workspacePaneId,
        branchName,
        statusCount: detail.statusCount,
        t,
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

  return workspacePaneTabTargetKey ? (
    <WorkspacePaneToolbar
      workspacePaneTabTargetKey={workspacePaneTabTargetKey}
      items={workspacePaneTabItems}
      workspacePaneId={workspacePaneId}
      activeTabIdentity={activeTabIdentity}
      createAction={workspacePaneCreateAction}
      trafficLightOffset={trafficLightOffset}
      onBackToNavigator={onBackToBranchNavigator}
      trailingActions={
        branchActions ? (
          <WorkspaceOpenExternallyMenu repo={repo} branch={detail.branch} branchActions={branchActions} />
        ) : null
      }
      onSelect={handleSelectWorkspacePaneTabItem}
      onReselect={handleReselectWorkspacePaneTabItem}
      onClose={handleCloseWorkspacePaneTab}
      onReorder={handleReorderWorkspacePaneTabStrip}
    />
  ) : null
}

function activePendingTabIdentity(model: RepoWorkspaceTabModel): string | null {
  const selection = model.selection
  if (selection?.kind !== 'runtime-host') return null
  const runtimeType = selection.runtimeType
  return model.tabs.find((tab) => tab.kind === 'pending' && tab.runtimeType === runtimeType)?.identity ?? null
}
