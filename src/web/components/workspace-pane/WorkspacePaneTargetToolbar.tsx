import { useCallback, useMemo } from 'react'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import {
  isPendingWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { WorkspacePaneToolbar } from '#/web/components/workspace-pane/WorkspacePaneToolbar.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { useWorkspacePaneRuntimeTabCreateAction } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-create-action.ts'
import { dispatchSelectWorkspacePaneTabByIdentityAction } from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import { useWorkspacePaneTabsReorderMutation } from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { useWorkspacePaneTabDragPreview } from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'
import { orderWorkspacePaneItemsByTabEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  workspacePaneTabEntryForItem,
  workspacePaneTabItems,
} from '#/web/components/workspace-pane/workspace-pane-tab-items.ts'
import {
  showCreatedTerminalWorkspacePaneRuntimeTab,
  type CreatedTerminalRouteRequest,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type {
  WorkspacePaneFilesystemTarget,
  WorkspacePaneSurfaceTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  workspacePaneFilesystemRootPath,
  workspacePaneFilesystemTerminalBase,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import {
  WorkspaceOpenExternallyMenuContent,
  useWorkspaceOpenExternallyItems,
} from '#/web/components/workspace-pane/WorkspaceOpenExternallyMenu.tsx'
import type { WorkspaceExternalAppItem } from '#/web/external-workspace-apps.tsx'

interface WorkspacePaneTargetToolbarProps {
  target: WorkspacePaneSurfaceTarget
  model: WorkspacePaneTabModel
  workspacePaneId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  statusCount: number
  trafficLightOffset?: boolean
  onBackToNavigator?: () => void
  staticTabAvailable?: Parameters<typeof workspacePaneTabItems>[0]['staticTabAvailable']
}

type WorkspacePaneFilesystemTargetToolbarProps = Omit<WorkspacePaneTargetToolbarProps, 'target'> & {
  target: WorkspacePaneFilesystemTarget
}

export function WorkspacePaneTargetToolbar(props: WorkspacePaneTargetToolbarProps) {
  return props.target.kind === 'git-branch' ? (
    <WorkspacePaneTargetToolbarContent {...props} externalItems={[]} />
  ) : (
    <WorkspacePaneFilesystemTargetToolbar {...props} target={props.target} />
  )
}

function WorkspacePaneFilesystemTargetToolbar(props: WorkspacePaneFilesystemTargetToolbarProps) {
  const externalItems = useWorkspaceOpenExternallyItems(props.target)
  return <WorkspacePaneTargetToolbarContent {...props} externalItems={externalItems} />
}

function WorkspacePaneTargetToolbarContent({
  target,
  model,
  workspacePaneId,
  workspacePaneRoute,
  statusCount,
  trafficLightOffset = false,
  onBackToNavigator,
  staticTabAvailable,
  externalItems,
}: WorkspacePaneTargetToolbarProps & { externalItems: readonly WorkspaceExternalAppItem[] }) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const { scrollToBottom } = useTerminalSessionContext()
  const branchName = model.branchName
  const filesystemTarget = target.kind === 'git-branch' ? null : target
  const routeTarget = requiredWorkspacePaneModelTarget(model.routeTarget, 'route')
  const persistenceTarget = requiredWorkspacePaneModelTarget(model.paneTarget, 'persistence')
  const commandTarget = workspacePaneCommandTargetForSurface(routeTarget, target, workspacePaneRoute)
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
      routeRequest: CreatedTerminalRouteRequest,
    ) => {
      if (type !== 'terminal') return false
      if (target.kind === 'git-branch') return false
      if (runtimeTarget.kind === 'workspace-root' && presentation.kind === 'workspace-root') {
        return showCreatedTerminalWorkspacePaneRuntimeTab(
          { target: runtimeTarget, presentation },
          sessionId,
          navigation,
          routeRequest,
        )
      }
      if (runtimeTarget.kind === 'git-worktree' && presentation.kind === 'git-worktree') {
        return showCreatedTerminalWorkspacePaneRuntimeTab(
          { target: runtimeTarget, presentation },
          sessionId,
          navigation,
          routeRequest,
        )
      }
      return false
    },
    [navigation, target],
  )
  const createAction = useWorkspacePaneRuntimeTabCreateAction({
    routeTarget,
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
      }),
    [branchName, model.runtimeTabStateByType, model.tabs, staticTabAvailable, statusCount, t, target, workspacePaneId],
  )
  const { visualTabs, stageDragPreview, clearDragPreview } = useWorkspacePaneTabDragPreview({
    ...persistenceTarget,
    workspaceRuntimeId: target.workspaceRuntimeId,
    canonicalTabs: model.tabEntries,
  })
  const { reorderTabs } = useWorkspacePaneTabsReorderMutation({
    ...persistenceTarget,
    workspaceRuntimeId: target.workspaceRuntimeId,
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
        workspaceId: target.workspaceId,
        routeTarget,
        paneTarget: persistenceTarget,
        worktreeHead,
        workspacePaneRoute,
        identity: item.identity,
        navigation,
        onTerminalReselect: scrollToBottom,
        reselect,
      })
    },
    [navigation, persistenceTarget, routeTarget, scrollToBottom, target.workspaceId, workspacePaneRoute, worktreeHead],
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
      trailingActions={
        filesystemTarget && externalItems.length > 0 ? (
          <WorkspaceOpenExternallyMenuContent target={filesystemTarget} items={externalItems} />
        ) : null
      }
      onSelect={(item) => selectItem(item, false)}
      onReselect={(item) => selectItem(item, true)}
      onClose={(item) => {
        if (isPendingWorkspacePaneTabItem(item)) return
        void runCloseWorkspacePaneTabCommand({
          workspaceId: target.workspaceId,
          target: commandTarget,
          targetIdentity: item.identity,
          runtimeView: item.kind === 'runtime' ? item.view : undefined,
          selectedIdentity: model.selectedIdentity,
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

function requiredWorkspacePaneModelTarget(
  target: WorkspacePaneTabModel['routeTarget'],
  role: 'route' | 'persistence',
): WorkspacePaneTabsTarget {
  if (target.kind === 'inactive') throw new Error(`inactive workspace pane has no ${role} target`)
  return target
}

function workspacePaneCommandTargetForSurface(
  target: WorkspacePaneTabsTarget,
  surface: WorkspacePaneSurfaceTarget,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): WorkspacePaneCommandTarget {
  if (target.kind === 'workspace-root') {
    if (surface.kind !== 'workspace-root') throw new Error('workspace-root route requires a workspace-root surface')
    return { routeTarget: target, workspacePaneRoute, filesystemTarget: surface }
  }
  if (target.kind === 'git-worktree') {
    if (surface.kind !== 'git-worktree') throw new Error('git-worktree route requires a git-worktree surface')
    return { routeTarget: target, workspacePaneRoute, filesystemTarget: surface }
  }
  if (surface.kind === 'workspace-root') throw new Error('git-branch route cannot use a workspace-root surface')
  return {
    routeTarget: target,
    workspacePaneRoute,
    filesystemTarget: surface.kind === 'git-worktree' ? surface : null,
  }
}

function activePendingTabIdentity(model: WorkspacePaneTabModel): string | null {
  const selection = model.selection
  if (selection?.kind !== 'runtime-host') return null
  return model.tabs.find((tab) => tab.kind === 'pending' && tab.runtimeType === selection.runtimeType)?.identity ?? null
}
