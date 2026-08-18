import { RefreshCw } from '@lucide/vue'
import { useIsFetching } from '@tanstack/vue-query'
import { computed, defineComponent, onMounted, onScopeDispose, shallowRef } from 'vue'
import type { FunctionalComponent, PropType } from 'vue'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import { useAppNavigation } from '#/web/app/navigation/context.tsx'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { useTerminalSessionContext } from '#/web/terminal/components/terminal-session-context.ts'
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
import { useWorkspacePaneTabsRetryActions } from '#/web/runtime/workspace-pane-tabs-recovery-context.ts'
import type { WorkspaceExternalAppItem } from '#/web/external-apps/catalog.tsx'
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
import {
  requiredWorkspacePaneTabModelLocation,
  workspacePaneTabModelBranchName,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { useWorkspacePaneRuntimeTabCreateAction } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-create-action.ts'
import { useWorkspacePaneTabsReorderMutation } from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { workspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

interface WorkspacePaneTargetToolbarProps {
  target: WorkspacePaneSurfaceTarget
  model: WorkspacePaneTabModel
  workspacePaneId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  statusCount: number | undefined
  trafficLightOffset?: boolean
  onBackToNavigator?: () => void
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
    'externalAppItems',
  ],

  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()
    const navigation = useAppNavigation()
    const tabsRetry = useWorkspacePaneTabsRetryActions()
    const tabsFetchCount = useIsFetching(
      computed(() => ({
        queryKey: workspacePaneTabsQueryKey(props.target.workspaceId, props.target.workspaceRuntimeId),
        exact: true,
      })),
    )
    const { scrollToBottom } = useTerminalSessionContext()
    const persistenceTarget = computed(() => requiredWorkspacePaneTabModelLocation(props.model).paneTarget)
    const commandTarget = computed(() =>
      workspacePaneCommandTargetForSurface(props.model.location, props.target, props.workspacePaneRoute),
    )
    // Scroll memory is local to one runtime epoch. A reopened workspace can
    // reuse the same durable target identity with a different tab projection.
    const targetKey = computed(
      () => `${props.target.workspaceRuntimeId}\0${workspacePaneTabsTargetIdentityKey(persistenceTarget.value)}`,
    )

    const showCreatedRuntimeTab = (
      type: WorkspacePaneRuntimeTabType,
      sessionId: string,
      presentation: TerminalPresentation,
      routeRequest: CreatedTerminalRouteRequest,
    ): boolean | Promise<boolean> => {
      if (type !== 'terminal' || props.target.kind === 'git-branch') return false
      const location = props.model.location
      if (!location || location.kind === 'branch') return false
      return showCreatedTerminalWorkspacePaneRuntimeTab(location, presentation, sessionId, navigation, routeRequest)
    }

    const runtimeTabCreateAction = useWorkspacePaneRuntimeTabCreateAction({
      location: () => (props.model.location?.kind === 'branch' ? null : props.model.location),
      runtimeTabStateByType: () => props.model.runtimeTabStateByType,
      workspacePaneRoute: () => props.workspacePaneRoute,
      showCreatedRuntimeTab,
      t,
    })
    const items = computed(() =>
      workspacePaneTabItems({
        model: props.model,
        workspacePaneId: props.workspacePaneId,
        branchName: workspacePaneTabModelBranchName(props.model),
        statusCount: props.statusCount,
        t,
      }),
    )
    const dragPreviewOwner = shallowRef<WorkspacePaneTabDragPreviewOwner | null>(null)
    const activateDragPreviewOwner = (owner: WorkspacePaneTabDragPreviewOwner) => {
      dragPreviewOwner.value = owner
    }
    const disposeDragPreviewOwner = (owner: WorkspacePaneTabDragPreviewOwner) => {
      if (dragPreviewOwner.value === owner) dragPreviewOwner.value = null
    }
    const tabsReorder = useWorkspacePaneTabsReorderMutation(() => ({
      location: requiredWorkspacePaneTabModelLocation(props.model),
      canonicalTabs: props.model.tabEntries,
    }))
    const visualTabs = computed(() => {
      const owner = dragPreviewOwner.value
      return owner?.key === targetKey.value ? owner.preview.visualTabs.value : props.model.tabEntries
    })
    const visualItems = computed(() =>
      orderWorkspacePaneItemsByTabEntries(items.value, visualTabs.value, workspacePaneTabEntryForItem),
    )
    const activeTabIdentity = computed(() => displayedSelectionIdentity(props.model))

    const selectItem = (item: WorkspacePaneTabItem, reselect: boolean) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      void dispatchSelectWorkspacePaneTabByIdentityAction({
        workspaceId: props.target.workspaceId,
        workspaceRuntimeId: props.target.workspaceRuntimeId,
        location: props.model.location!,
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
      const retryTabsLabel = t('workspace-pane-tabs.retry-loading')
      const tabsRetrying = tabsFetchCount.value > 0
      const retryTabsAction =
        props.model.tabEntriesProjectionPhase === 'failed' ? (
          <Tip label={retryTabsLabel}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={retryTabsLabel}
              aria-busy={tabsRetrying || undefined}
              disabled={tabsRetrying}
              onClick={() => tabsRetry.retryWorkspace(props.target.workspaceId)}
            >
              <RefreshCw aria-hidden="true" class={tabsRetrying ? 'animate-spin' : undefined} />
            </Button>
          </Tip>
        ) : null

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
            createAction={props.target.capabilities.terminal.available ? runtimeTabCreateAction.value : null}
            trafficLightOffset={props.trafficLightOffset ?? false}
            onBackToNavigator={props.onBackToNavigator}
            trailingActions={
              retryTabsAction || showExternalAppLauncher ? (
                <>
                  {retryTabsAction}
                  {showExternalAppLauncher ? (
                    <WorkspaceExternalAppLauncher target={filesystemTarget} items={props.externalAppItems} />
                  ) : null}
                </>
              ) : null
            }
            onSelect={(item) => selectItem(item, false)}
            onReselect={(item) => selectItem(item, true)}
            onClose={(item, presentationEffects) => {
              if (isPendingWorkspacePaneTabItem(item) || item.kind === 'runtime-placeholder') {
                presentationEffects?.onAbandon()
                return
              }
              void runCloseWorkspacePaneTabCommand({
                workspaceId: props.target.workspaceId,
                target: commandTarget.value,
                targetIdentity: item.identity,
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

function workspacePaneCommandTargetForSurface(
  location: WorkspacePaneTabModel['location'],
  surface: WorkspacePaneSurfaceTarget,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): WorkspacePaneCommandTarget {
  if (!location) throw new Error('inactive workspace pane has no command target')
  if (location.kind === 'workspace-root' || location.kind === 'source-worktree') {
    if (surface.kind !== 'workspace-root') throw new Error('workspace-root route requires a workspace-root surface')
    if (surface.workspaceId !== location.workspaceId) {
      throw new Error('workspace-root route requires its canonical workspace surface')
    }
    return { location, workspacePaneRoute, capabilities: surface.capabilities }
  }
  if (location.kind === 'linked-worktree') {
    if (surface.kind !== 'git-worktree') throw new Error('git-worktree route requires a git-worktree surface')
    const surfaceTarget = workspacePaneTabsTargetForFilesystemTarget(surface)
    if (
      surfaceTarget.workspaceId !== location.workspaceId ||
      surfaceTarget.worktreePath !== location.routeTarget.worktreePath
    ) {
      throw new Error('git-worktree route requires its canonical worktree surface')
    }
    return { location, workspacePaneRoute, capabilities: surface.capabilities }
  }
  if (surface.kind !== 'git-branch') throw new Error('git-branch route requires a git-branch surface')
  if (workspacePaneRoute?.kind === 'terminal') throw new Error('git-branch route cannot present a runtime tab')
  return { location, workspacePaneRoute }
}

function displayedSelectionIdentity(model: WorkspacePaneTabModel): string | null {
  const selection = model.selection
  if (selection?.kind === 'runtime-host') {
    const pendingIdentity = model.tabs.find(
      (tab) => tab.kind === 'pending' && tab.runtimeType === selection.runtimeType,
    )?.identity
    if (pendingIdentity) return pendingIdentity
  }
  return model.selectedIdentity && model.tabs.some((tab) => tab.identity === model.selectedIdentity)
    ? model.selectedIdentity
    : null
}
