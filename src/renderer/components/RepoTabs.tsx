// Top repository tab strip — one compact tab per opened repository. Click
// to focus, hover to reveal the close (×) button. The active tab gets a
// raised surface treatment so it reads as the selected workspace above the
// repository body.
//
// Drag-to-reorder uses dnd-kit (the de-facto choice in the React/shadcn/
// tanstack ecosystem). PointerSensor with a small activation distance lets
// a regular click still focus the repo without triggering a drag; keyboard
// users use Arrow keys for tab activation.

import { toast } from 'sonner'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { RepoTabStrip } from '#/renderer/components/repo-tabs/RepoTabStrip.tsx'
import { CloneRepositoryDialog, type CloneRepositoryRequest } from '#/renderer/components/CloneRepositoryDialog.tsx'
import type { RepoTabSummary } from '#/renderer/components/repo-tabs/types.ts'
import type { CloneRepoResult } from '#/shared/rpc.ts'
import { rpc } from '#/renderer/rpc.ts'

/** Equality fn for the summaries array. Zustand's `useShallow` does
 *  Object.is on each element — but we re-create the inner objects
 *  every selector run, so refs always differ. Compare the relevant
 *  string fields explicitly so the tab strip only re-renders when the
 *  rendered text actually changes. */
function summariesEqual(a: RepoTabSummary[], b: RepoTabSummary[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.id !== y.id || x.name !== y.name || x.unavailable !== y.unavailable) return false
  }
  return true
}

interface RepoTabsProps {
  cloneOpen: boolean
  onCloneOpenChange: (open: boolean) => void
}

export function RepoTabs({ cloneOpen, onCloneOpenChange }: RepoTabsProps) {
  const t = useT()
  const shortcutsDisabled = useSettingsStore((s) => s.shortcutsDisabled)
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
          return r ? { id: r.id, name: r.name, unavailable: r.availability.phase === 'unavailable' } : null
        })
        .filter((x): x is RepoTabSummary => x !== null),
    summariesEqual,
  )
  const activeId = useReposStore((s) => s.activeId)
  const setActive = useReposStore((s) => s.setActive)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const openRepo = useReposStore((s) => s.openRepo)
  const reorderRepos = useReposStore((s) => s.reorderRepos)

  async function handleOpenLocal() {
    const path = await rpc.repo.openDialog.mutate()
    if (!path) return
    const result = await openRepo(path)
    if (!result.ok) {
      toast.error(t('drop.open-failed'), {
        description: t(result.message),
      })
    }
  }

  async function handleClone(request: CloneRepositoryRequest): Promise<CloneRepoResult> {
    const result = await rpc.repo.clone.mutate(request)
    if (!result.ok || !result.path) return result
    const openResult = await openRepo(result.path)
    if (!openResult.ok) {
      toast.error(t('drop.open-failed'), {
        description: `${result.path}\n${t(openResult.message)}`,
      })
      return { ok: false, message: openResult.message, path: result.path }
    }
    toast.success(t('repo-tabs.clone-opened'), { description: result.path })
    return result
  }

  return (
    <>
      <RepoTabStrip
        repos={summaries}
        activeId={activeId}
        labels={{
          repositories: t('repo-tabs.repos'),
          close: t('repo-tabs.close'),
          dragToReorder: t('repo-tabs.drag-to-reorder'),
          open: t('topbar.open'),
          openLocal: t('repo-tabs.open-local'),
          openLocalShortcut: shortcutsDisabled ? null : '⌘O',
          clone: t('repo-tabs.clone'),
          cloneShortcut: shortcutsDisabled ? null : '⌘⇧O',
          unavailable: t('repo-unavailable.title'),
        }}
        onActivate={setActive}
        onClose={closeRepo}
        onReorder={reorderRepos}
        onOpenLocal={handleOpenLocal}
        onClone={() => onCloneOpenChange(true)}
      />
      <CloneRepositoryDialog open={cloneOpen} onClose={() => onCloneOpenChange(false)} onClone={handleClone} />
    </>
  )
}
