// Top repository tab strip — one compact tab per opened repository. Click
// to focus, hover to reveal the close (×) button. The active tab gets a
// raised surface treatment so it reads as the selected workspace above the
// repository body.
//
// Drag-to-reorder uses dnd-kit (the de-facto choice in the React/shadcn/
// tanstack ecosystem). PointerSensor with a small activation distance lets
// a regular click still focus the repo without triggering a drag; keyboard
// users use Arrow keys for tab activation.

import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { RepoTabStrip } from '#/renderer/components/repo-tabs/RepoTabStrip.tsx'
import type { RepoTabSummary } from '#/renderer/components/repo-tabs/types.ts'
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
    if (x.id !== y.id || x.name !== y.name) return false
  }
  return true
}

export function RepoTabs() {
  const t = useT()
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
          return r ? { id: r.id, name: r.name } : null
        })
        .filter((x): x is RepoTabSummary => x !== null),
    summariesEqual,
  )
  const activeId = useReposStore((s) => s.activeId)
  const setActive = useReposStore((s) => s.setActive)
  const closeRepo = useReposStore((s) => s.closeRepo)
  const openRepo = useReposStore((s) => s.openRepo)
  const reorderRepos = useReposStore((s) => s.reorderRepos)
  const missing = useReposStore(useShallow((s) => s.missingFromSession))
  const dismissMissing = useReposStore((s) => s.dismissMissing)

  async function handleOpen() {
    const path = await rpc.repo.openDialog.query()
    if (!path) return
    await openRepo(path)
  }

  return (
    <RepoTabStrip
      repos={summaries}
      activeId={activeId}
      missing={missing}
      labels={{
        repositories: t('repo-tabs.repos'),
        emptyBefore: t('repo-tabs.empty.before'),
        emptyOpenLabel: t('repo-tabs.empty.open-label'),
        emptyAfter: t('repo-tabs.empty.after'),
        close: t('repo-tabs.close'),
        dragToReorder: t('repo-tabs.drag-to-reorder'),
        open: t('topbar.open'),
        missingTitle: t('repo-tabs.missing-title', { n: missing.length }),
        missingDismiss: t('repo-tabs.missing-dismiss'),
      }}
      onActivate={setActive}
      onClose={closeRepo}
      onReorder={reorderRepos}
      onOpen={handleOpen}
      onDismissMissing={dismissMissing}
    />
  )
}
