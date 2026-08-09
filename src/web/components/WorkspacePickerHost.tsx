// Data-binding host for the workspace picker. Presentation stays in the
// canonical workspace-picker component modules.

import { computed, defineComponent } from 'vue'
import { toast } from 'vue-sonner'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceNameFromLocator } from '#/shared/workspace-display-location.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { useWorkspaceTerminalBellCounts } from '#/web/components/terminal/terminal-session-store.ts'
import { WorkspacePicker } from '#/web/components/workspace-picker/WorkspacePicker.tsx'
import { workspacePickerItemsEqual } from '#/web/components/workspace-picker/summary-equality.ts'
import type { WorkspacePickerItem, WorkspacePickerSurface } from '#/web/components/workspace-picker/types.ts'
import { openWorkspaceFromDialog } from '#/web/lib/open-workspace-dialog.ts'
import { useShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

interface WorkspacePickerHostProps {
  currentWorkspaceId: WorkspaceId | null
  onOpenWorkspacePathDialog: () => void
  onOpenRemote: () => void
  onClone: () => void
  surface?: WorkspacePickerSurface
}

export const WorkspacePickerHost = defineComponent<WorkspacePickerHostProps>({
  name: 'WorkspacePickerHost',
  props: ['currentWorkspaceId', 'onOpenWorkspacePathDialog', 'onOpenRemote', 'onClone', 'surface'],

  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const shortcutSettings = useShortcutSettings()
    const summaries = useStoreSelector(
      workspacesStore,
      (state) =>
        state.workspaceOrder
          .map<WorkspacePickerItem | null>((id) => {
            const workspace = state.workspaces[id]
            if (!workspace) return null
            const gitAvailable = workspace.capability.kind === 'git'
            return {
              id: workspace.id,
              name: workspaceNameFromLocator(workspace.id),
              gitCapability: gitAvailable
                ? 'available'
                : workspace.capability.kind === 'filesystem'
                  ? 'unavailable'
                  : 'unknown',
              git: gitAvailable ? { remoteDetails: undefined } : null,
              lifecycle: workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
            }
          })
          .filter((workspace): workspace is WorkspacePickerItem => workspace !== null),
      workspacePickerItemsEqual,
    )
    const workspaceIds = computed(() => summaries.value.map((workspace) => workspace.id))
    const terminalBellCounts = useWorkspaceTerminalBellCounts(workspaceIds)
    const summariesWithTerminalBells = computed(() =>
      summaries.value.map<WorkspacePickerItem>((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        gitCapability: workspace.gitCapability,
        git: workspace.git,
        lifecycle: workspace.lifecycle,
        terminalBellCount: terminalBellCounts.value[workspace.id] ?? 0,
      })),
    )
    const { openWorkspaceMembership } = workspacesStore.getState()

    async function openLocalWorkspace(): Promise<void> {
      await openWorkspaceFromDialog({
        openWorkspaceMembership,
        activateWorkspace: navigation.activateWorkspace,
        openWorkspacePathDialog: props.onOpenWorkspacePathDialog,
        t,
      })
    }

    async function closeWorkspace(workspaceId: WorkspaceId): Promise<void> {
      const workspace = workspacesStore.getState().workspaces[workspaceId]
      if (!workspace) return
      const result = await navigation.closeWorkspace(workspace.id)
      if (!result.ok) {
        const errorMessageKey = result.message
        toast.error(t(errorMessageKey))
      }
    }

    return () => {
      const shortcutsDisabled = shortcutSettings.value.shortcutsDisabled
      return (
        <WorkspacePicker
          workspaces={summariesWithTerminalBells.value}
          currentWorkspaceId={props.currentWorkspaceId}
          labels={{
            workspaces: t('workspace-picker.workspaces'),
            closeWithName: (name) => t('workspace-picker.close-named', { name }),
            open: t('app-chrome.open'),
            placeholder: t('workspace-picker.placeholder'),
            openLocal: t('workspace-picker.open-local'),
            openLocalShortcut: shortcutsDisabled ? null : '⌘O',
            openRemote: t('workspace-picker.open-remote'),
            openRemoteShortcut: shortcutsDisabled ? null : '⌘⇧R',
            clone: t('workspace-picker.clone'),
            cloneShortcut: shortcutsDisabled ? null : '⌘⇧O',
            unavailable: t('workspace-unavailable.title'),
          }}
          onActivate={navigation.activateWorkspace}
          onClose={(workspaceId) => void closeWorkspace(workspaceId)}
          onOpenLocal={() => void openLocalWorkspace()}
          onOpenRemote={props.onOpenRemote}
          onClone={props.onClone}
          surface={props.surface ?? 'toolbar'}
        />
      )
    }
  },
})
