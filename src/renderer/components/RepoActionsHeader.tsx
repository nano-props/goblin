// Repo-level chrome buttons. Two actions sit here, both unrelated to
// any single branch:
//
//   Refresh — re-runs git ops to rebuild the local snapshot (branches,
//             status, log) from the current on-disk state. Used as a
//             manual nudge when the user knows external changes have
//             happened (a CLI commit in another window, a worktree
//             switch outside the app) and doesn't want to wait for the
//             background fetch / file watcher.
//
//   Fetch   — `git fetch --all --prune` on origin. Network-bound; while
//             in flight the button shows a spinner and disables itself.
//             Stuck SSH/network calls fail via the git helper timeout
//             and surface through the normal error toast.
//
// Branch-scoped operations (Checkout / Pull / Push / Open in Ghostty
// / Open in GitHub) live in `BranchActionsMenu` on each branch row,
// not here — those need a branch context to be meaningful.

import { useEffect, useState } from 'react'
import { CloudDownload, FolderPlus, Loader2, RotateCw } from 'lucide-react'
import { useReposStore, type RepoState } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { CreateWorktreeDialog } from '#/renderer/components/CreateWorktreeDialog.tsx'

interface Props {
  repo: RepoState
}

export function RepoActionsHeader({ repo }: Props) {
  const t = useT()
  const setLastResult = useReposStore((s) => s.setLastResult)
  const refreshAll = useReposStore((s) => s.refreshAll)
  const refreshSnapshot = useReposStore((s) => s.refreshSnapshot)
  const refreshStatus = useReposStore((s) => s.refreshStatus)
  const clearFetchFailed = useReposStore((s) => s.clearFetchFailed)
  const [fetchBusy, setFetchBusy] = useState(false)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  // RepoView reuses the same React instance across repo switches
  // (no `key={activeId}` on the parent), so RepoActionsHeader keeps
  // its state when the user moves to a different repo. Force-close
  // the create-worktree dialog on repo change so a half-typed branch
  // name from repo A doesn't leak into a submission against repo B.
  useEffect(() => {
    setCreateOpen(false)
  }, [repo.id])

  async function handleRefresh() {
    if (refreshBusy) return
    setRefreshBusy(true)
    try {
      await refreshAll(repo.id)
    } finally {
      setRefreshBusy(false)
    }
  }

  async function handleFetch() {
    if (fetchBusy) return
    setFetchBusy(true)
    try {
      const result = await window.gbl.fetch(repo.id)
      if (!result.ok && result.message === 'cancelled') return
      setLastResult(repo.id, result)
      if (!result.ok && result.message === 'error.networkOpInProgress') return
      // Fetch can move the upstream pointer (origin's refs change), so
      // the snapshot needs to re-read ahead/behind counts. We also
      // refresh status because the badge is always visible and may have
      // gone stale from external filesystem changes.
      await refreshSnapshot(repo.id)
      await refreshStatus(repo.id)
      if (result.ok) clearFetchFailed(repo.id)
    } finally {
      setFetchBusy(false)
    }
  }

  // Both buttons carry their label inline — earlier revisions used
  // size="icon" with two refresh-like glyphs (RefreshCcw / RefreshCw)
  // that read as the same icon at 14px and made the user guess which
  // was which. The labels remove that ambiguity at the cost of a
  // little extra width; tooltips still elaborate on what each does.
  return (
    <div className="flex items-center gap-1">
      <Tip label={t('action.refreshTitle')}>
        <Button variant="ghost" onClick={handleRefresh} disabled={refreshBusy}>
          <RotateCw className={refreshBusy ? 'animate-spin' : ''} />
          {t('action.refresh')}
        </Button>
      </Tip>
      <Tip label={t('action.fetchTitle')}>
        <Button variant="ghost" onClick={handleFetch} disabled={fetchBusy}>
          {fetchBusy ? <Loader2 className="animate-spin" /> : <CloudDownload />}
          {t('action.fetch')}
        </Button>
      </Tip>
      <Tip label={t('action.createWorktreeTitle')}>
        <Button variant="ghost" onClick={() => setCreateOpen(true)}>
          <FolderPlus />
          {t('action.createWorktree')}
        </Button>
      </Tip>
      <CreateWorktreeDialog open={createOpen} repo={repo} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
