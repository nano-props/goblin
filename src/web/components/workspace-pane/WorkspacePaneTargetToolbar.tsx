import { useCallback, useMemo } from 'react'
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
import { orderWorkspacePaneItemsByTabEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  workspacePaneTabEntryForItem,
  workspacePaneTabItems,
} from '#/web/components/workspace-pane/workspace-pane-tab-items.ts'
import { showCreatedTerminalWorkspacePaneRuntimeTab } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { WorkspacePaneSurfaceTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  workspacePaneFilesystemRootPath,
  workspacePaneFilesystemTerminalBase,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { gitHeadBranch } from '#/shared/git-head.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import type { PrimaryWindowPresentationToken } from '#/web/primary-window-presentation.ts'
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
  target: Exclude<WorkspacePaneSurfaceTarget, { kind: 'git-branch' }>
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
  const branchName =
    target.kind === 'workspace-root'
      ? null
      : target.kind === 'git-branch'
        ? target.branchName
        : gitHeadBranch(target.head)
  const rootPath = target.kind === 'git-branch' ? null : workspacePaneFilesystemRootPath(target)
  const filesystemTarget = target.kind === 'git-branch' ? null : target
  const commandTarget: WorkspacePaneCommandTarget =
    target.kind === 'workspace-root'
      ? { kind: 'workspace-root', workspacePaneRoute: workspacePaneRoute ?? null, filesystemTarget: target }
      : target.kind === 'git-branch'
        ? { kind: 'git-branch', branchName: target.branchName, workspacePaneRoute: workspacePaneRoute ?? null }
        : { kind: 'git-worktree', workspacePaneRoute: workspacePaneRoute ?? null, filesystemTarget: target }
  const persistenceTarget = useMemo(
    () =>
      target.kind === 'workspace-root'
        ? { kind: 'workspace-root' as const, workspaceId: target.workspaceId }
        : target.kind === 'git-branch'
          ? { kind: 'git-branch' as const, workspaceId: target.workspaceId, branchName: target.branchName }
          : {
              kind: 'git-worktree' as const,
              workspaceId: target.workspaceId,
              worktreePath: workspacePaneFilesystemRootPath(target),
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
      presentationToken: PrimaryWindowPresentationToken,
    ) => {
      if (type !== 'terminal') return false
      if (target.kind === 'git-branch') return false
      if (runtimeTarget.kind === 'workspace-root' && presentation.kind === 'workspace-root') {
        return showCreatedTerminalWorkspacePaneRuntimeTab(
          { target: runtimeTarget, presentation },
          sessionId,
          navigation,
          presentationToken,
        )
      }
      if (runtimeTarget.kind === 'git-worktree' && presentation.kind === 'git-worktree') {
        return showCreatedTerminalWorkspacePaneRuntimeTab(
          { target: runtimeTarget, presentation },
          sessionId,
          navigation,
          presentationToken,
        )
      }
      return false
    },
    [navigation, target],
  )
  const showRuntimeTab = useCallback(
    (type: WorkspacePaneRuntimeTabType, sessionId: string) => {
      if (type !== 'terminal') return false
      if (target.kind === 'workspace-root') {
        return (
          navigation.showWorkspaceRootPaneTab?.(target.workspaceId, {
            kind: 'terminal',
            terminalSessionId: sessionId,
          }) ?? false
        )
      }
      if (target.kind !== 'git-worktree') return false
      const targetBranch = gitHeadBranch(target.head)
      return targetBranch
        ? navigation.showRepoBranchTerminalSession(target.workspaceId, targetBranch, sessionId)
        : (navigation.showRepoWorktreeTerminalSession?.(
            target.workspaceId,
            workspacePaneFilesystemRootPath(target),
            sessionId,
          ) ?? false)
    },
    [navigation, rootPath, target],
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

function activePendingTabIdentity(model: WorkspacePaneTabModel): string | null {
  const selection = model.selection
  if (selection?.kind !== 'runtime-host') return null
  return model.tabs.find((tab) => tab.kind === 'pending' && tab.runtimeType === selection.runtimeType)?.identity ?? null
}
