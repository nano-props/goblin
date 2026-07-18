import { useCallback, useMemo, type ReactNode } from 'react'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import {
  isPendingWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { WorkspacePaneToolbar } from '#/web/components/workspace-pane/WorkspacePaneToolbar.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useWorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-action-context.ts'
import { useWorkspacePaneRuntimeTabCreateAction } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-create-action.ts'
import { dispatchSelectWorkspacePaneTabByIdentityAction } from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import { useWorkspacePaneTabsReorderMutation } from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { useWorkspacePaneTabDragPreview } from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'
import {
  orderWorkspacePaneItemsByTabEntries,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'
import type { RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  workspacePaneTabEntryForItem,
  workspacePaneTabItems,
} from '#/web/components/repo-workspace/workspace-pane-tab-items.ts'
import { showCreatedTerminalWorkspacePaneRuntimeTab } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneSurfaceTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneFilesystemTerminalBase } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { gitHeadBranch } from '#/shared/git-head.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'

interface WorkspacePaneTargetToolbarProps {
  target: WorkspacePaneSurfaceTarget
  model: RepoWorkspaceTabModel
  workspacePaneId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  statusCount: number
  trafficLightOffset?: boolean
  onBackToNavigator?: () => void
  trailingActions?: ReactNode
  staticTabAvailable?: Parameters<typeof workspacePaneTabItems>[0]['staticTabAvailable']
}

export function WorkspacePaneTargetToolbar({
  target,
  model,
  workspacePaneId,
  workspacePaneRoute,
  statusCount,
  trafficLightOffset = false,
  onBackToNavigator,
  trailingActions,
  staticTabAvailable,
}: WorkspacePaneTargetToolbarProps) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const branchName =
    target.kind === 'workspace-root' ? null : target.kind === 'git-branch' ? target.branchName : gitHeadBranch(target.head)
  const rootPath = target.kind === 'git-branch' ? null : target.rootPath
  const commandTarget: WorkspacePaneCommandTarget =
    target.kind === 'workspace-root'
      ? { kind: 'workspace-root', workspacePaneRoute: workspacePaneRoute ?? null, filesystemTarget: target }
      : target.kind === 'git-branch'
        ? { kind: 'git-branch', branchName: target.branchName, workspacePaneRoute: workspacePaneRoute ?? null }
        : { kind: 'git-worktree', workspacePaneRoute: workspacePaneRoute ?? null, filesystemTarget: target }
  const persistenceTarget = useMemo(
    () =>
      target.kind === 'workspace-root'
        ? { kind: 'workspace-root' as const, repoRoot: target.workspaceId }
        : target.kind === 'git-branch'
          ? { kind: 'git-branch' as const, repoRoot: target.workspaceId, branchName: target.branchName }
          : {
              kind: 'git-worktree' as const,
              repoRoot: target.workspaceId,
              worktreePath: target.rootPath,
            },
    [branchName, rootPath, target.kind, target.workspaceId],
  )
  const worktreeHead = useMemo(
    () => (target.kind === 'git-worktree' ? target.head : undefined),
    [branchName, target.kind],
  )
  const targetKey = workspacePaneTabsTargetIdentityKey(persistenceTarget)
  const showCreatedRuntimeTab = useCallback(
    (
      type: WorkspacePaneRuntimeTabType,
      sessionId: string,
      presentation: TerminalPresentation,
      runtimeTarget: RuntimeWorkspacePaneTarget,
    ) => {
      if (type !== 'terminal') return false
      if (target.kind === 'workspace-root') {
        if (presentation.kind !== 'workspace-root') return false
        const state = useReposStore.getState()
        state.setSelectedTerminal(formatTerminalWorktreeKeyForPath(target.workspaceId, target.rootPath), sessionId)
        state.setWorkspacePaneTabForTarget(persistenceTarget, 'terminal')
        return true
      }
      if (target.kind !== 'git-worktree') return false
      if (presentation.kind !== 'git-worktree') return false
      if (runtimeTarget.kind !== 'git-worktree') return false
      return showCreatedTerminalWorkspacePaneRuntimeTab(
        { target: runtimeTarget, presentation },
        sessionId,
        navigation,
      )
    },
    [navigation, persistenceTarget, target],
  )
  const showRuntimeTab = useCallback(
    (type: WorkspacePaneRuntimeTabType, sessionId: string) => {
      if (type !== 'terminal') return false
      if (target.kind === 'workspace-root') {
        const state = useReposStore.getState()
        state.setSelectedTerminal(formatTerminalWorktreeKeyForPath(target.workspaceId, target.rootPath), sessionId)
        state.setWorkspacePaneTabForTarget(persistenceTarget, 'terminal')
        return true
      }
      if (target.kind !== 'git-worktree') return false
      const targetBranch = gitHeadBranch(target.head)
      if (targetBranch) return navigation.showRepoBranchTerminalSession(target.workspaceId, targetBranch, sessionId)
      const state = useReposStore.getState()
      state.setSelectedTerminal(formatTerminalWorktreeKeyForPath(target.workspaceId, target.rootPath), sessionId)
      state.setWorkspacePaneTabForTarget(persistenceTarget, 'terminal')
      return true
    },
    [navigation, persistenceTarget, target],
  )
  const runtimeActionContext = useWorkspacePaneRuntimeTabActionContext({ showRuntimeTab })
  const createAction = useWorkspacePaneRuntimeTabCreateAction({
    base: target.kind === 'git-branch' ? null : workspacePaneFilesystemTerminalBase(target),
    runtimeTabStateByType: model.runtimeTabStateByType,
    workspacePaneRoute,
    showCreatedRuntimeTab,
    t,
  })
  const items = useMemo(
    () =>
      workspacePaneTabItems({
        model,
        workspacePaneId,
        branchName,
        statusCount,
        t,
        staticTabAvailable,
        runtimeTabAvailable: (type) => type !== 'terminal' || target.capabilities.terminal.available,
      }),
    [branchName, model.runtimeTabStateByType, model.tabs, staticTabAvailable, statusCount, t, target, workspacePaneId],
  )
  const { visualTabs, stageDragPreview, clearDragPreview } = useWorkspacePaneTabDragPreview({
    ...persistenceTarget,
    repoRuntimeId: target.workspaceRuntimeId,
    canonicalTabs: model.tabEntries,
  })
  const { reorderTabs } = useWorkspacePaneTabsReorderMutation({
    ...persistenceTarget,
    repoRuntimeId: target.workspaceRuntimeId,
    canonicalTabs: model.tabEntries,
    onReorderRejected: clearDragPreview,
  })
  const visualItems = useMemo(
    () => orderWorkspacePaneItemsByTabEntries(items, visualTabs, workspacePaneTabEntryForItem),
    [items, visualTabs],
  )
  const selectItem = useCallback(
    (item: WorkspacePaneTabItem, reselect: boolean) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      void dispatchSelectWorkspacePaneTabByIdentityAction({
        repoId: target.workspaceId,
        paneTarget: persistenceTarget,
        worktreeHead,
        workspacePaneRoute,
        identity: item.identity,
        navigation,
        runtimeActionContext,
        reselect,
      })
    },
    [navigation, persistenceTarget, runtimeActionContext, target.workspaceId, workspacePaneRoute, worktreeHead],
  )
  const activeTabIdentity = model.activeTab?.identity ?? activePendingTabIdentity(model)

  return (
    <WorkspacePaneToolbar
      workspacePaneTabTargetKey={targetKey}
      items={visualItems}
      workspacePaneId={workspacePaneId}
      activeTabIdentity={activeTabIdentity}
      createAction={target.capabilities.terminal.available ? createAction : null}
      trafficLightOffset={trafficLightOffset}
      onBackToNavigator={onBackToNavigator}
      trailingActions={trailingActions}
      onSelect={(item) => selectItem(item, false)}
      onReselect={(item) => selectItem(item, true)}
      onClose={(item) => {
        if (isPendingWorkspacePaneTabItem(item)) return
        void runCloseWorkspacePaneTabCommand({
          repoId: target.workspaceId,
          target: commandTarget,
          targetIdentity: item.identity,
          navigation,
        })
      }}
      onReorder={(tabs: WorkspacePaneTabEntry[]) => {
        if (!stageDragPreview(tabs)) return
        reorderTabs(tabs)
      }}
    />
  )
}

function activePendingTabIdentity(model: RepoWorkspaceTabModel): string | null {
  const selection = model.selection
  if (selection?.kind !== 'runtime-host') return null
  return (
    model.tabs.find((tab) => tab.kind === 'pending' && tab.runtimeType === selection.runtimeType)?.identity ?? null
  )
}
