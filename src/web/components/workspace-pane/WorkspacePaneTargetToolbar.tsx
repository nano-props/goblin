import { computed, defineComponent, onMounted, onScopeDispose, shallowRef } from 'vue'
import type { FunctionalComponent, PropType } from 'vue'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  WorkspaceExternalAppLauncher,
  useWorkspaceExternalAppItems,
} from '#/web/components/workspace-pane/WorkspaceExternalAppLauncher.tsx'
import { WorkspacePaneToolbar } from '#/web/components/workspace-pane/WorkspacePaneToolbar.tsx'
import { useWorkspacePaneTabDragPreview } from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'
import type { WorkspacePaneTabDragPreviewState } from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'
import { isPendingWorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { WorkspaceExternalAppItem } from '#/web/external-workspace-apps.tsx'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import type {
  WorkspacePaneFilesystemTarget,
  WorkspacePaneSurfaceTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  workspacePaneFilesystemTerminalBase,
  workspacePaneTabsTargetForFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { showCreatedTerminalWorkspacePaneRuntimeTab } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { CreatedTerminalRouteRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { dispatchSelectWorkspacePaneTabByIdentityAction } from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import {
  workspacePaneTabEntryForItem,
  workspacePaneTabItems,
} from '#/web/components/workspace-pane/workspace-pane-tab-items.ts'
import { orderWorkspacePaneItemsByTabEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import type { WorkspacePaneModelTarget, WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { useWorkspacePaneRuntimeTabCreateAction } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-create-action.ts'
import { useWorkspacePaneTabsReorderMutation } from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import type { WorkspacePaneTabsReorderMutationInput } from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'

interface WorkspacePaneTargetToolbarProps {
  target: WorkspacePaneSurfaceTarget
  model: WorkspacePaneTabModel
  workspacePaneId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  statusCount: number | undefined
  trafficLightOffset?: boolean
  onBackToNavigator?: () => void
  staticTabAvailable?: Parameters<typeof workspacePaneTabItems>[0]['staticTabAvailable']
}

type WorkspacePaneFilesystemTargetToolbarProps = Omit<WorkspacePaneTargetToolbarProps, 'target'> & {
  target: WorkspacePaneFilesystemTarget
}

export const WorkspacePaneTargetToolbar: FunctionalComponent<WorkspacePaneTargetToolbarProps> = (props) =>
  props.target.kind === 'git-branch' ? (
    <WorkspacePaneTargetToolbarContent {...props} externalAppItems={[]} />
  ) : (
    <WorkspacePaneFilesystemTargetToolbar {...props} target={props.target} />
  )

WorkspacePaneTargetToolbar.props = [
  'target',
  'model',
  'workspacePaneId',
  'workspacePaneRoute',
  'statusCount',
  'trafficLightOffset',
  'onBackToNavigator',
  'staticTabAvailable',
]

const WorkspacePaneFilesystemTargetToolbar = defineComponent<WorkspacePaneFilesystemTargetToolbarProps>({
  name: 'WorkspacePaneFilesystemTargetToolbar',
  props: [
    'target',
    'model',
    'workspacePaneId',
    'workspacePaneRoute',
    'statusCount',
    'trafficLightOffset',
    'onBackToNavigator',
    'staticTabAvailable',
  ],

  setup(props) {
    const externalAppItems = useWorkspaceExternalAppItems(() => props.target)
    return () => <WorkspacePaneTargetToolbarContent {...props} externalAppItems={externalAppItems.value} />
  },
})

interface WorkspacePaneTargetToolbarContentProps extends WorkspacePaneTargetToolbarProps {
  externalAppItems: readonly WorkspaceExternalAppItem[]
}

const WorkspacePaneTargetToolbarContent = defineComponent<WorkspacePaneTargetToolbarContentProps>({
  name: 'WorkspacePaneTargetToolbarContent',
  props: [
    'target',
    'model',
    'workspacePaneId',
    'workspacePaneRoute',
    'statusCount',
    'trafficLightOffset',
    'onBackToNavigator',
    'staticTabAvailable',
    'externalAppItems',
  ],

  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()
    const navigation = useAppNavigation()
    const { scrollToBottom } = useTerminalSessionContext()
    const routeTarget = computed(() => requiredWorkspacePaneModelTarget(props.model.routeTarget, 'route'))
    const persistenceTarget = computed(() => requiredWorkspacePaneModelTarget(props.model.paneTarget, 'persistence'))
    const commandTarget = computed(() =>
      workspacePaneCommandTargetForSurface(routeTarget.value, props.target, props.workspacePaneRoute),
    )
    const worktreeHead = computed(() => (props.target.kind === 'git-worktree' ? props.target.head : undefined))
    // Scroll memory is local to one runtime epoch. A reopened workspace can
    // reuse the same durable target identity with a different tab projection.
    const targetKey = computed(
      () => `${props.target.workspaceRuntimeId}\0${workspacePaneTabsTargetIdentityKey(persistenceTarget.value)}`,
    )

    const showCreatedRuntimeTab = (
      type: WorkspacePaneRuntimeTabType,
      sessionId: string,
      presentation: TerminalPresentation,
      runtimeTarget: RuntimeWorkspacePaneTarget,
      routeRequest: CreatedTerminalRouteRequest,
    ): boolean | Promise<boolean> => {
      if (type !== 'terminal' || props.target.kind === 'git-branch') return false
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
    }

    const createAction = useWorkspacePaneRuntimeTabCreateAction({
      base: () => (props.target.kind === 'git-branch' ? null : workspacePaneFilesystemTerminalBase(props.target)),
      runtimeTabStateByType: () => props.model.runtimeTabStateByType,
      workspacePaneRoute: () => props.workspacePaneRoute,
      showCreatedRuntimeTab,
      t,
    })
    const items = computed(() =>
      workspacePaneTabItems({
        model: props.model,
        workspacePaneId: props.workspacePaneId,
        branchName: props.model.branchName,
        statusCount: props.statusCount,
        t,
        staticTabAvailable: props.staticTabAvailable,
      }),
    )
    const dragPreviewOwner = shallowRef<WorkspacePaneTabDragPreviewOwner | null>(null)
    const activateDragPreviewOwner = (owner: WorkspacePaneTabDragPreviewOwner) => {
      dragPreviewOwner.value = owner
    }
    const disposeDragPreviewOwner = (owner: WorkspacePaneTabDragPreviewOwner) => {
      if (dragPreviewOwner.value === owner) dragPreviewOwner.value = null
    }
    const tabsReorder = useWorkspacePaneTabsReorderMutation(() =>
      tabsMutationInput(persistenceTarget.value, props.target.workspaceRuntimeId, props.model.tabEntries),
    )
    const visualTabs = computed(() => {
      const owner = dragPreviewOwner.value
      return owner?.key === targetKey.value ? owner.preview.visualTabs.value : props.model.tabEntries
    })
    const visualItems = computed(() =>
      orderWorkspacePaneItemsByTabEntries(items.value, visualTabs.value, workspacePaneTabEntryForItem),
    )
    const activeTabIdentity = computed(() => props.model.activeTab?.identity ?? activePendingTabIdentity(props.model))

    const selectItem = (item: WorkspacePaneTabItem, reselect: boolean) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      void dispatchSelectWorkspacePaneTabByIdentityAction({
        workspaceId: props.target.workspaceId,
        workspaceRuntimeId: props.target.workspaceRuntimeId,
        routeTarget: routeTarget.value,
        paneTarget: persistenceTarget.value,
        worktreeHead: worktreeHead.value,
        workspacePaneRoute: props.workspacePaneRoute,
        identity: item.identity,
        navigation,
        onTerminalReselect: scrollToBottom,
        reselect,
      })
    }

    return () => {
      const filesystemTarget = props.target.kind === 'git-branch' ? null : props.target
      const showExternalAppLauncher = !compact.value && filesystemTarget !== null && props.externalAppItems.length > 0

      return (
        <>
          <WorkspacePaneTabDragPreviewOwner
            key={targetKey.value}
            ownerKey={targetKey.value}
            canonicalTabs={props.model.tabEntries}
            onActivate={activateDragPreviewOwner}
            onDispose={disposeDragPreviewOwner}
          />
          <WorkspacePaneToolbar
            key="workspace-pane-toolbar"
            workspacePaneTabTargetKey={targetKey.value}
            items={visualItems.value}
            workspacePaneId={props.workspacePaneId}
            activeTabIdentity={activeTabIdentity.value}
            createAction={props.target.capabilities.terminal.available ? createAction.value : null}
            trafficLightOffset={props.trafficLightOffset ?? false}
            onBackToNavigator={props.onBackToNavigator}
            trailingActions={
              showExternalAppLauncher ? (
                <WorkspaceExternalAppLauncher target={filesystemTarget} items={props.externalAppItems} />
              ) : null
            }
            onSelect={(item) => selectItem(item, false)}
            onReselect={(item) => selectItem(item, true)}
            onClose={(item, presentationEffects) => {
              if (isPendingWorkspacePaneTabItem(item)) {
                presentationEffects?.onAbandon()
                return
              }
              void runCloseWorkspacePaneTabCommand({
                workspaceId: props.target.workspaceId,
                target: commandTarget.value,
                targetIdentity: item.identity,
                runtimeView: item.kind === 'runtime' ? item.view : undefined,
                selectedIdentity: props.model.selectedIdentity,
                navigation,
                ...(presentationEffects ? { presentationEffects } : {}),
              })
            }}
            onReorder={(tabs: WorkspacePaneTabEntry[]) => {
              const owner = dragPreviewOwner.value
              const releasePreview = owner?.key === targetKey.value ? owner.preview.stageDragPreview(tabs) : null
              if (!releasePreview) return
              tabsReorder.reorderTabs(tabs, releasePreview)
            }}
          />
        </>
      )
    }
  },
})

interface WorkspacePaneTabDragPreviewOwner {
  key: string
  preview: WorkspacePaneTabDragPreviewState
}

const WorkspacePaneTabDragPreviewOwner = defineComponent<{
  ownerKey: string
  canonicalTabs: readonly WorkspacePaneTabEntry[]
  onActivate: (owner: WorkspacePaneTabDragPreviewOwner) => void
  onDispose: (owner: WorkspacePaneTabDragPreviewOwner) => void
}>({
  name: 'WorkspacePaneTabDragPreviewOwner',
  props: {
    ownerKey: { type: String, required: true },
    canonicalTabs: { type: Array as PropType<WorkspacePaneTabEntry[]>, required: true },
    onActivate: { type: Function as PropType<(owner: WorkspacePaneTabDragPreviewOwner) => void>, required: true },
    onDispose: { type: Function as PropType<(owner: WorkspacePaneTabDragPreviewOwner) => void>, required: true },
  },

  setup(props) {
    const owner: WorkspacePaneTabDragPreviewOwner = {
      key: props.ownerKey,
      preview: useWorkspacePaneTabDragPreview(() => props.canonicalTabs),
    }
    onMounted(() => props.onActivate(owner))
    onScopeDispose(() => props.onDispose(owner))
    return () => null
  },
})

function tabsMutationInput(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
  canonicalTabs: readonly WorkspacePaneTabEntry[],
): WorkspacePaneTabsReorderMutationInput {
  if (target.kind === 'workspace-root') {
    return {
      kind: 'workspace-root',
      workspaceId: target.workspaceId,
      workspaceRuntimeId,
      canonicalTabs,
    }
  }
  if (target.kind === 'git-branch') {
    return {
      kind: 'git-branch',
      workspaceId: target.workspaceId,
      branchName: target.branchName,
      workspaceRuntimeId,
      canonicalTabs,
    }
  }
  return {
    kind: 'git-worktree',
    workspaceId: target.workspaceId,
    worktreePath: target.worktreePath,
    workspaceRuntimeId,
    canonicalTabs,
  }
}

function requiredWorkspacePaneModelTarget(
  target: WorkspacePaneModelTarget,
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
    if (surface.workspaceId !== target.workspaceId) {
      throw new Error('workspace-root route requires its canonical workspace surface')
    }
    return { workspacePaneRoute, filesystemTarget: surface }
  }
  if (target.kind === 'git-worktree') {
    if (surface.kind !== 'git-worktree') throw new Error('git-worktree route requires a git-worktree surface')
    const surfaceTarget = workspacePaneTabsTargetForFilesystemTarget(surface)
    if (surfaceTarget.workspaceId !== target.workspaceId || surfaceTarget.worktreePath !== target.worktreePath) {
      throw new Error('git-worktree route requires its canonical worktree surface')
    }
    return { workspacePaneRoute, filesystemTarget: surface }
  }
  if (surface.kind !== 'git-branch') throw new Error('git-branch route requires a git-branch surface')
  if (workspacePaneRoute?.kind === 'terminal') throw new Error('git-branch route cannot present a runtime tab')
  return {
    workspaceRuntimeId: surface.workspaceRuntimeId,
    routeTarget: target,
    workspacePaneRoute,
    filesystemTarget: null,
  }
}

function activePendingTabIdentity(model: WorkspacePaneTabModel): string | null {
  const selection = model.selection
  if (selection?.kind !== 'runtime-host') return null
  return model.tabs.find((tab) => tab.kind === 'pending' && tab.runtimeType === selection.runtimeType)?.identity ?? null
}
