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
// / Open in GitHub) live with the selected-branch detail, not here —
// those need a branch context to be meaningful.

import { useEffect, useRef, useState } from 'react'
import { CloudDownload, FolderPlus, Loader2, RotateCw } from 'lucide-react'
import { useReposStore, type RepoState } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { CreateWorktreeDialog, type CreateWorktreeRequest } from '#/renderer/components/CreateWorktreeDialog.tsx'

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
  const [fetchBusyByRepo, setFetchBusyByRepo] = useState<Record<string, boolean>>({})
  const [refreshBusyByRepo, setRefreshBusyByRepo] = useState<Record<string, boolean>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [creatingByRepo, setCreatingByRepo] = useState<Record<string, string>>({})
  const [createTipByRepo, setCreateTipByRepo] = useState<Record<string, boolean>>({})
  const createTipTimers = useRef<Record<string, number>>({})
  const fetchBusyRef = useRef<Record<string, boolean>>({})
  const refreshBusyRef = useRef<Record<string, boolean>>({})
  const creatingRef = useRef<Record<string, boolean>>({})

  // RepoView reuses the same React instance across repo switches
  // (no `key={activeId}` on the parent), so RepoActionsHeader keeps
  // its state when the user moves to a different repo. Force-close
  // the create-worktree dialog on repo change so a half-typed branch
  // name from repo A doesn't leak into a submission against repo B.
  useEffect(() => {
    setCreateOpen(false)
  }, [repo.id])

  useEffect(
    () => () => {
      for (const timer of Object.values(createTipTimers.current)) window.clearTimeout(timer)
    },
    [],
  )

  async function handleRefresh() {
    const targetRepoId = repo.id
    const token = repo.instanceToken
    if (refreshBusyRef.current[targetRepoId]) return
    refreshBusyRef.current[targetRepoId] = true
    setRefreshBusyByRepo((s) => ({ ...s, [targetRepoId]: true }))
    try {
      await refreshAll(targetRepoId, { token })
    } finally {
      delete refreshBusyRef.current[targetRepoId]
      setRefreshBusyByRepo((s) => {
        if (!s[targetRepoId]) return s
        const next = { ...s }
        delete next[targetRepoId]
        return next
      })
    }
  }

  async function handleFetch() {
    const targetRepoId = repo.id
    const token = repo.instanceToken
    if (fetchBusyRef.current[targetRepoId]) return
    fetchBusyRef.current[targetRepoId] = true
    setFetchBusyByRepo((s) => ({ ...s, [targetRepoId]: true }))
    try {
      const result = await window.gbl.fetch(targetRepoId)
      if (!result.ok && result.message === 'cancelled') return
      setLastResult(targetRepoId, result, token)
      if (!result.ok && result.message === 'error.networkOpInProgress') return
      // Fetch can move the upstream pointer (origin's refs change), so
      // the snapshot needs to re-read ahead/behind counts. We also
      // refresh status because the badge is always visible and may have
      // gone stale from external filesystem changes.
      await refreshSnapshot(targetRepoId, { token })
      await refreshStatus(targetRepoId, { token })
      if (result.ok) clearFetchFailed(targetRepoId, token)
    } finally {
      delete fetchBusyRef.current[targetRepoId]
      setFetchBusyByRepo((s) => {
        if (!s[targetRepoId]) return s
        const next = { ...s }
        delete next[targetRepoId]
        return next
      })
    }
  }

  function showCreateTip(repoId: string) {
    const existing = createTipTimers.current[repoId]
    if (existing) window.clearTimeout(existing)
    setCreateTipByRepo((s) => ({ ...s, [repoId]: true }))
    createTipTimers.current[repoId] = window.setTimeout(() => {
      setCreateTipByRepo((s) => {
        if (!s[repoId]) return s
        const next = { ...s }
        delete next[repoId]
        return next
      })
      delete createTipTimers.current[repoId]
    }, 3000)
  }

  async function handleCreateWorktree(request: CreateWorktreeRequest) {
    const targetRepoId = repo.id
    const token = repo.instanceToken
    if (creatingRef.current[targetRepoId]) return
    creatingRef.current[targetRepoId] = true
    setCreatingByRepo((s) => ({ ...s, [targetRepoId]: request.newBranch }))
    showCreateTip(targetRepoId)
    try {
      const result = await window.gbl.createWorktree(
        targetRepoId,
        request.worktreePath,
        request.newBranch,
        request.baseBranch,
      )
      setLastResult(targetRepoId, result, token)
      if (result.ok) {
        await refreshSnapshot(targetRepoId, { token })
        await refreshStatus(targetRepoId, { token })
      }
    } catch (err) {
      setLastResult(targetRepoId, { ok: false, message: err instanceof Error ? err.message : String(err) }, token)
    } finally {
      delete creatingRef.current[targetRepoId]
      setCreatingByRepo((s) => {
        if (!s[targetRepoId]) return s
        const next = { ...s }
        delete next[targetRepoId]
        return next
      })
    }
  }

  const creatingBranch = creatingByRepo[repo.id]
  const createBusy = !!creatingBranch
  const fetchBusy = !!fetchBusyByRepo[repo.id]
  const refreshBusy = !!refreshBusyByRepo[repo.id]
  const createTip = createBusy
    ? t('action.createWorktreeCreatingTitle', { branch: creatingBranch })
    : t('action.createWorktreeTitle')

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
      <Tip label={createTip} forceOpen={createBusy && !!createTipByRepo[repo.id]}>
        <span className="inline-flex">
          <Button
            variant="ghost"
            onClick={() => setCreateOpen(true)}
            disabled={createBusy}
            aria-busy={createBusy}
            aria-label={createTip}
          >
            {createBusy ? <Loader2 className="animate-spin" /> : <FolderPlus />}
            {t('action.createWorktree')}
          </Button>
        </span>
      </Tip>
      <CreateWorktreeDialog
        open={createOpen}
        repo={repo}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreateWorktree}
      />
    </div>
  )
}
