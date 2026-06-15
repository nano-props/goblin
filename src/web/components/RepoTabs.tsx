// Top repository tab strip — one compact tab per opened repository. Click
// to focus, hover to reveal the close (×) button. The active tab gets a
// raised surface treatment so it reads as the selected workspace above the
// repository body.
//
// Drag-to-reorder uses dnd-kit (the de-facto choice in the React/shadcn/
// tanstack ecosystem). PointerSensor with a small activation distance lets
// a regular click still focus the repo without triggering a drag; keyboard
// users use Arrow keys for tab activation.
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
import { isRepoUnavailable } from '#/web/stores/repos/helpers.ts'

interface RepoTabsProps {
  currentRepoId: string | null
  onOpenRepoPathDialog: () => void
  onOpenRemote: () => void
  onClone: () => void
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
            lifecycle: r.remote.lifecycle,
            unavailable: isRepoUnavailable(r),
          }
        })
        .filter((x): x is RepoTabSummary => x !== null),
    repoTabSummariesEqual,
  )
  const navigation = useMainWindowNavigation()
  const { ensureWorkspaceOpen, reorderRepos } = useStoreWithEqualityFn(
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
        dragToReorder: t('repo-tabs.drag-to-reorder'),
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
      onReorder={reorderRepos}
      onOpenLocal={handleOpenLocal}
      onOpenRemote={onOpenRemote}
      onClone={onClone}
    />
  )
}
