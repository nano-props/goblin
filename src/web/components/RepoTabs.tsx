// Top repository tab strip — the active repository stays visible in the
// compact toolbar while every open repository and open/clone action lives
// in the switcher popover. Keyboard users can still move between repos with
// Arrow/Home/End from the visible tab.
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { RepoTabStrip } from '#/web/components/repo-tabs/RepoTabStrip.tsx'
import { repoTabSummariesEqual } from '#/web/components/repo-tabs/summary-equality.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
import { openRepoFromDialog } from '#/web/lib/open-repo-dialog.ts'
import { useRuntimeShortcutSettings } from '#/web/runtime-settings-shortcuts.ts'
import { repoTabStoreActionsEqual, repoTabStoreActionsFromStore } from '#/web/stores/repos/selector-actions.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

interface RepoTabsProps {
  currentRepoId: string | null
  onOpenRepoPathDialog: () => void
  onOpenRemote: () => void
  onClone: () => void
}

export function latestRepoSyncTime(repo: Pick<RepoState, 'projection' | 'resources'>): number | null {
  const snapshotLoadedAt = repo.projection.source === 'fresh' ? repo.resources.snapshot.loadedAt : null
  const times = [repo.resources.fetch.loadedAt, snapshotLoadedAt].filter((time): time is number => time !== null)
  return times.length === 0 ? null : Math.max(...times)
}

export function RepoTabs({ currentRepoId, onOpenRepoPathDialog, onOpenRemote, onClone }: RepoTabsProps) {
  const t = useT()
  const { shortcutsDisabled } = useRuntimeShortcutSettings()
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
        .map<RepoTabSummary | null>((id) => {
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
        .filter((x): x is RepoTabSummary => x !== null),
    repoTabSummariesEqual,
  )
  const navigation = useMainWindowNavigation()
  const { ensureWorkspaceOpen } = useStoreWithEqualityFn(
    useReposStore,
    repoTabStoreActionsFromStore,
    repoTabStoreActionsEqual,
  )

  async function handleOpenLocal() {
    await openRepoFromDialog({
      ensureWorkspaceOpen,
      activateRepo: navigation.activateRepo,
      openRepoPathDialog: onOpenRepoPathDialog,
      t,
    })
  }

  return (
    <RepoTabStrip
      repos={summaries}
      activeId={currentRepoId}
      labels={{
        repositories: t('repo-tabs.repos'),
        closeWithName: (name) => t('repo-tabs.close-named', { name }),
        more: t('repo-tabs.more'),
        open: t('topbar.open'),
        openLocal: t('repo-tabs.open-local'),
        openLocalShortcut: shortcutsDisabled ? null : '⌘O',
        openRemote: t('repo-tabs.open-remote'),
        openRemoteShortcut: shortcutsDisabled ? null : '⌘⇧R',
        clone: t('repo-tabs.clone'),
        cloneShortcut: shortcutsDisabled ? null : '⌘⇧O',
        unavailable: t('repo-unavailable.title'),
      }}
      onActivate={navigation.activateRepo}
      onClose={navigation.closeRepo}
      onOpenLocal={handleOpenLocal}
      onOpenRemote={onOpenRemote}
      onClone={onClone}
    />
  )
}
