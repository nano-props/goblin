// Data-binding host for the workspace picker. Presentation stays in the
// canonical workspace-picker component modules.

import { computed, defineComponent } from 'vue'
import { toast } from 'vue-sonner'
import type { WorkspaceOrderEdge } from '#/shared/workspace-order.ts'
import { hasErrorCode } from '#/shared/error-code.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceNameFromLocator } from '#/shared/workspace-display-location.ts'
import { useAppNavigation } from '#/web/app/navigation/context.tsx'
import { useAppRouteNavigation } from '#/web/app/navigation/route-navigation.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useWorkspaceTerminalBellCounts } from '#/web/terminal/components/terminal-session-store.ts'
import { WorkspacePicker } from '#/web/components/workspace-picker/WorkspacePicker.tsx'
import { workspacePickerItemsEqual } from '#/web/components/workspace-picker/summary-equality.ts'
import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import { reportCloseWorkspaceFailure } from '#/web/lib/open-workspace-result-feedback.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

interface WorkspacePickerHostProps {
  currentWorkspaceId: WorkspaceId | null
  onOpenWorkspacePathDialog: () => void
  onOpenRemote: () => void
  onClone: () => void
}

export const WorkspacePickerHost = defineComponent<WorkspacePickerHostProps>({
  name: 'WorkspacePickerHost',
  props: ['currentWorkspaceId', 'onOpenWorkspacePathDialog', 'onOpenRemote', 'onClone'],

  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const routeNavigation = useAppRouteNavigation()
    const compact = useIsCompactUi()
    const summaries = useStoreSelector(
      workspacesStore,
      (state) =>
        state.workspaceOrder
          .map<WorkspacePickerItem | null>((id) => {
            const workspace = state.workspaces[id]
            if (!workspace) return null
            return {
              id: workspace.id,
              name: workspaceNameFromLocator(workspace.id),
              gitAvailable: workspace.capability.kind === 'git',
              lifecycle: workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
            }
          })
          .filter((workspace): workspace is WorkspacePickerItem => workspace !== null),
      workspacePickerItemsEqual,
    )
    const showActiveWorkspaceOnly = useStoreSelector(workspacesStore, (state) => state.showActiveWorkspaceOnly)
    const currentWorkspace = computed(() =>
      summaries.value.find((workspace) => workspace.id === props.currentWorkspaceId),
    )
    const visibleSummaries = computed(() => {
      const current = currentWorkspace.value
      return showActiveWorkspaceOnly.value && current ? [current] : summaries.value
    })
    const filterStatusLabel = computed(() => {
      const labelKey = !showActiveWorkspaceOnly.value
        ? 'workspace-picker.filter-tooltip.all'
        : currentWorkspace.value
          ? 'workspace-picker.filter-tooltip.active'
          : 'workspace-picker.filter-tooltip.pending'
      return t(labelKey)
    })
    const workspaceIds = computed(() => visibleSummaries.value.map((workspace) => workspace.id))
    const terminalBellCounts = useWorkspaceTerminalBellCounts(workspaceIds)
    const summariesWithTerminalBells = computed(() =>
      visibleSummaries.value.map<WorkspacePickerItem>((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        gitAvailable: workspace.gitAvailable,
        lifecycle: workspace.lifecycle,
        terminalBellCount: terminalBellCounts.value[workspace.id] ?? 0,
      })),
    )

    const movePending = useStoreSelector(workspacesStore, (state) => state.workspaceMovePending)

    async function moveWorkspace(workspaceId: WorkspaceId, edge: WorkspaceOrderEdge): Promise<void> {
      try {
        await workspacesStore.getState().moveWorkspace(workspaceId, edge)
      } catch (error) {
        const messageKey = hasErrorCode(error, 'OUTCOME_UNCERTAIN')
          ? 'workspace-picker.move-uncertain'
          : 'workspace-picker.move-failed'
        toast.error(t(messageKey))
      }
    }

    async function closeWorkspace(workspaceId: WorkspaceId): Promise<void> {
      const workspace = workspacesStore.getState().workspaces[workspaceId]
      if (!workspace) return
      const result = await navigation.closeWorkspace(workspace.id)
      reportCloseWorkspaceFailure(result, t)
    }

    return () => (
      <WorkspacePicker
        workspaces={summariesWithTerminalBells.value}
        currentWorkspaceId={props.currentWorkspaceId}
        showActiveWorkspaceOnly={showActiveWorkspaceOnly.value}
        onShowActiveWorkspaceOnlyChange={(enabled) => workspacesStore.getState().setShowActiveWorkspaceOnly(enabled)}
        labels={{
          filter: t('workspace-picker.filter-label'),
          filterStatus: filterStatusLabel.value,
          workspaces: t('workspace-picker.workspaces'),
          close: t('workspace-picker.close'),
          moveFirst: t('workspace-picker.move-first'),
          moveLast: t('workspace-picker.move-last'),
          open: t('workspace-picker.open-title'),
          openLocal: t('workspace-picker.open-local'),
          openRemote: t('workspace-picker.open-remote'),
          clone: t('workspace-picker.clone'),
          unavailable: t('workspace-unavailable.title'),
        }}
        onActivate={(workspaceId, onCommit) => {
          const options = onCommit ? { onCommit } : undefined
          if (compact.value) {
            routeNavigation.openWorkspaceNavigator(workspaceId, options)
            return
          }

          const result = navigation.activateWorkspace(workspaceId, options)
          if (result === 'blocked')
            toast.warning(t('workspace-picker.switch-blocked'), { id: 'workspace-switch-blocked' })
        }}
        onOpenDashboard={routeNavigation.openWorkspaceDashboard}
        refreshOrder={workspacesStore.getState().refreshWorkspaceOrder}
        movePending={movePending.value}
        onMove={(workspaceId, edge) => void moveWorkspace(workspaceId, edge)}
        onClose={(workspaceId) => void closeWorkspace(workspaceId)}
        onOpenLocal={props.onOpenWorkspacePathDialog}
        onOpenRemote={props.onOpenRemote}
        onClone={props.onClone}
      />
    )
  },
})
