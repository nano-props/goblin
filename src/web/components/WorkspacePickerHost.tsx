// Data-binding host for the workspace picker. The picker itself owns
// toolbar/sidebar presentation; this host only supplies workspace summaries,
// labels, and open/switch actions.
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { WorkspacePicker } from '#/web/components/workspace-picker/WorkspacePicker.tsx'
import { workspacePickerItemsEqual } from '#/web/components/workspace-picker/summary-equality.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePickerItem, WorkspacePickerSurface } from '#/web/components/workspace-picker/types.ts'
import { openWorkspaceFromDialog } from '#/web/lib/open-workspace-dialog.ts'
import { useShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { workspacePickerStoreActionsFromStore } from '#/web/stores/workspaces/selector-actions.ts'
import { useMemo } from 'react'
import { useWorkspaceTerminalBellCounts } from '#/web/components/terminal/terminal-session-store.ts'
import { toast } from 'sonner'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface WorkspacePickerHostProps {
  currentWorkspaceId: WorkspaceId | null
  onOpenWorkspacePathDialog: () => void
  onOpenRemote: () => void
  onClone: () => void
  surface?: WorkspacePickerSurface
}

export function WorkspacePickerHost({
  currentWorkspaceId,
  onOpenWorkspacePathDialog,
  onOpenRemote,
  onClone,
  surface = 'toolbar',
}: WorkspacePickerHostProps) {
  const t = useT()
  const { shortcutsDisabled } = useShortcutSettings()
  // Build the summary array inside the selector but compare with our
  // explicit equality fn so re-derivations with identical contents
  // don't trigger a re-render. Zustand v5's primary `useWorkspacesStore`
  // hook drops the second-arg equality fn — `useStoreWithEqualityFn`
  // from `zustand/traditional` is the v5 escape hatch for cases like
  // this where shallow on Object.is misses the structurally-equal
  // case.
  const summaries = useStoreWithEqualityFn(
    useWorkspacesStore,
    (s) =>
      s.workspaceOrder
        .map<WorkspacePickerItem | null>((id) => {
          const workspace = s.workspaces[id]
          if (!workspace) return null
          const git = workspace.capability.kind === 'git' ? workspace.capability.git : null
          return {
            id: workspace.id,
            name: workspace.name,
            gitCapability:
              workspace.capability.kind === 'git'
                ? 'available'
                : workspace.capability.kind === 'filesystem'
                  ? 'unavailable'
                  : 'unknown',
            git: git
              ? {
                  remoteDetails: git.remote.remoteDetails,
                }
              : null,
            lifecycle: workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
          }
        })
        .filter((x): x is WorkspacePickerItem => x !== null),
    workspacePickerItemsEqual,
  )
  const workspaceIds = useMemo(() => summaries.map((workspace) => workspace.id), [summaries])
  const terminalBellCounts = useWorkspaceTerminalBellCounts(workspaceIds)
  const summariesWithTerminalBells = useMemo(
    () =>
      summaries.map((workspace) => ({
        ...workspace,
        terminalBellCount: terminalBellCounts[workspace.id] ?? 0,
      })),
    [summaries, terminalBellCounts],
  )
  const currentWorkspacePickerId = currentWorkspaceId
  const navigation = usePrimaryWindowNavigation()
  const { ensureWorkspaceOpen } = useWorkspacesStore(useShallow(workspacePickerStoreActionsFromStore))

  async function handleOpenLocal() {
    await openWorkspaceFromDialog({
      ensureWorkspaceOpen,
      activateWorkspace: navigation.activateWorkspace,
      openWorkspacePathDialog: onOpenWorkspacePathDialog,
      t,
    })
  }

  async function handleClose(workspaceId: WorkspaceId) {
    const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
    if (!workspace) return
    const result = await navigation.closeWorkspace(workspace.id)
    if (!result.ok) toast.error(t(result.message))
  }

  return (
    <WorkspacePicker
      workspaces={summariesWithTerminalBells}
      currentWorkspaceId={currentWorkspacePickerId}
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
      onClose={(workspaceId) => void handleClose(workspaceId)}
      onOpenLocal={handleOpenLocal}
      onOpenRemote={onOpenRemote}
      onClone={onClone}
      surface={surface}
    />
  )
}
