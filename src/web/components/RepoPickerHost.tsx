// Data-binding host for the repository picker. The picker itself owns
// toolbar/sidebar presentation; this host only supplies repo summaries,
// labels, and open/switch actions.
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useShallow } from 'zustand/react/shallow'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { RepoPicker } from '#/web/components/repo-picker/RepoPicker.tsx'
import { repoPickerReposEqual } from '#/web/components/repo-picker/summary-equality.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type { RepoPickerRepo, RepoPickerSurface } from '#/web/components/repo-picker/types.ts'
import { openRepoFromDialog } from '#/web/lib/open-repo-dialog.ts'
import { useShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { repoPickerStoreActionsFromStore } from '#/web/stores/repos/selector-actions.ts'
import { latestRepoSyncTime } from '#/web/stores/repos/sync-time.ts'
import { useMemo } from 'react'
import { useRepoTerminalBellCounts } from '#/web/components/terminal/terminal-session-store.ts'
import { toast } from 'sonner'

interface RepoPickerHostProps {
  currentRepoId: string | null
  onOpenRepoPathDialog: () => void
  onOpenRemote: () => void
  onClone: () => void
  surface?: RepoPickerSurface
}

export function RepoPickerHost({
  currentRepoId,
  onOpenRepoPathDialog,
  onOpenRemote,
  onClone,
  surface = 'toolbar',
}: RepoPickerHostProps) {
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
        .map<RepoPickerRepo | null>((id) => {
          const r = s.repos[id]
          if (!r) return null
          return {
            id: r.id,
            name: r.name,
            remoteDetails: r.remote.remoteDetails ?? [],
            lastSyncedAt: latestRepoSyncTime(r),
            lifecycle: r.remote.lifecycle,
          }
        })
        .filter((x): x is RepoPickerRepo => x !== null),
    repoPickerReposEqual,
  )
  const repoIds = useMemo(() => summaries.map((repo) => repo.id), [summaries])
  const terminalBellCounts = useRepoTerminalBellCounts(repoIds)
  const summariesWithTerminalBells = useMemo(
    () => summaries.map((repo) => ({ ...repo, terminalBellCount: terminalBellCounts[repo.id] ?? 0 })),
    [summaries, terminalBellCounts],
  )
  const navigation = usePrimaryWindowNavigation()
  const { ensureWorkspaceOpen } = useReposStore(useShallow(repoPickerStoreActionsFromStore))

  async function handleOpenLocal() {
    await openRepoFromDialog({
      ensureWorkspaceOpen,
      activateRepo: navigation.activateRepo,
      openRepoPathDialog: onOpenRepoPathDialog,
      t,
    })
  }

  async function handleClose(repoId: string) {
    const result = await navigation.closeRepo(repoId)
    if (!result.ok) toast.error(t(result.message))
  }

  return (
    <RepoPicker
      repos={summariesWithTerminalBells}
      currentRepoId={currentRepoId}
      labels={{
        repositories: t('repo-picker.repos'),
        closeWithName: (name) => t('repo-picker.close-named', { name }),
        open: t('app-chrome.open'),
        placeholder: t('repo-picker.placeholder'),
        openLocal: t('repo-picker.open-local'),
        openLocalShortcut: shortcutsDisabled ? null : '⌘O',
        openRemote: t('repo-picker.open-remote'),
        openRemoteShortcut: shortcutsDisabled ? null : '⌘⇧R',
        clone: t('repo-picker.clone'),
        cloneShortcut: shortcutsDisabled ? null : '⌘⇧O',
        unavailable: t('repo-unavailable.title'),
      }}
      onActivate={navigation.activateRepo}
      onClose={(repoId) => void handleClose(repoId)}
      onOpenLocal={handleOpenLocal}
      onOpenRemote={onOpenRemote}
      onClone={onClone}
      surface={surface}
    />
  )
}
