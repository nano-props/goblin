// Data-binding host for the workspace picker. The picker itself owns
// toolbar/sidebar presentation; this host only supplies workspace summaries,
// labels, and open/switch actions.
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useShallow } from 'zustand/react/shallow'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { WorkspacePicker } from '#/web/components/workspace-picker/WorkspacePicker.tsx'
import { workspacePickerItemsEqual } from '#/web/components/workspace-picker/summary-equality.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePickerItem, WorkspacePickerSurface } from '#/web/components/workspace-picker/types.ts'
import { openRepoFromDialog } from '#/web/lib/open-repo-dialog.ts'
import { useShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { workspacePickerStoreActionsFromStore } from '#/web/stores/repos/selector-actions.ts'
import { latestRepoSyncTime } from '#/web/stores/repos/sync-time.ts'
import { useMemo } from 'react'
import { useRepoTerminalBellCounts } from '#/web/components/terminal/terminal-session-store.ts'
import { toast } from 'sonner'

interface WorkspacePickerHostProps {
  currentWorkspaceId: string | null
  onOpenRepoPathDialog: () => void
  onOpenRemote: () => void
  onClone: () => void
  surface?: WorkspacePickerSurface
}

export function WorkspacePickerHost({
  currentWorkspaceId,
  onOpenRepoPathDialog,
  onOpenRemote,
  onClone,
  surface = 'toolbar',
}: WorkspacePickerHostProps) {
  const t = useT()
  const { shortcutsDisabled } = useShortcutSettings()
  // Build the summary array inside the selector but compare with our
  // explicit equality fn so re-derivations with identical contents
  // don't trigger a re-render. Zustand v5's primary `useReposStore`
  // hook drops the second-arg equality fn — `useStoreWithEqualityFn`
  // from `zustand/traditional` is the v5 escape hatch for cases like
  // this where shallow on Object.is misses the structurally-equal
  // case.
  const summaries = useStoreWithEqualityFn(
    useReposStore,
    (s) =>
      s.order
        .map<WorkspacePickerItem | null>((id) => {
          const workspace = s.repos[id]
          if (!workspace) return null
          return {
            id: workspace.id,
            name: workspace.name,
            gitCapability:
              workspace.workspaceProbe.status === 'ready'
                ? workspace.workspaceProbe.capabilities.git.status
                : 'unknown',
            remoteDetails: workspace.remote.remoteDetails ?? [],
            lastSyncedAt: latestRepoSyncTime(workspace),
            lifecycle: workspace.remote.lifecycle,
          }
        })
        .filter((x): x is WorkspacePickerItem => x !== null),
    workspacePickerItemsEqual,
  )
  const workspaceIds = useMemo(() => summaries.map((workspace) => workspace.id), [summaries])
  const terminalBellCounts = useRepoTerminalBellCounts(workspaceIds)
  const summariesWithTerminalBells = useMemo(
    () =>
      summaries.map((workspace) => ({
        ...workspace,
        terminalBellCount: terminalBellCounts[workspace.id] ?? 0,
      })),
    [summaries, terminalBellCounts],
  )
  const navigation = usePrimaryWindowNavigation()
  const { ensureWorkspaceOpen } = useReposStore(useShallow(workspacePickerStoreActionsFromStore))

  async function handleOpenLocal() {
    await openRepoFromDialog({
      ensureWorkspaceOpen,
      activateRepo: navigation.activateRepo,
      openRepoPathDialog: onOpenRepoPathDialog,
      t,
    })
  }

  async function handleClose(workspaceId: string) {
    const result = await navigation.closeRepo(workspaceId)
    if (!result.ok) toast.error(t(result.message))
  }

  return (
    <WorkspacePicker
      workspaces={summariesWithTerminalBells}
      currentWorkspaceId={currentWorkspaceId}
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
        unavailable: t('repo-unavailable.title'),
      }}
      onActivate={navigation.activateRepo}
      onClose={(workspaceId) => void handleClose(workspaceId)}
      onOpenLocal={handleOpenLocal}
      onOpenRemote={onOpenRemote}
      onClone={onClone}
      surface={surface}
    />
  )
}
