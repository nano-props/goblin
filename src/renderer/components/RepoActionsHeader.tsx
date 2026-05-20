// Repo-level chrome buttons. These actions sit here because they are
// unrelated to any single branch:
//
//   Refresh — `git fetch --all --prune` on origin, then rebuilds the
//             local snapshot (branches, status, log) from disk.
//
// Branch-scoped operations (Checkout / Pull / Push / Open in Ghostty
// / Open in GitHub) live with the selected-branch detail, not here —
// those need a branch context to be meaningful.

import { useEffect, useRef, useState } from 'react'
import { FolderPlus, Loader2, RotateCw } from 'lucide-react'
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
  const syncAndRefresh = useReposStore((s) => s.syncAndRefresh)
  const refreshSnapshot = useReposStore((s) => s.refreshSnapshot)
  const refreshStatus = useReposStore((s) => s.refreshStatus)
  const [syncBusyByRepo, setSyncBusyByRepo] = useState<Record<string, boolean>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [creatingByRepo, setCreatingByRepo] = useState<Record<string, string>>({})
  const [createTipByRepo, setCreateTipByRepo] = useState<Record<string, boolean>>({})
  const createTipTimers = useRef<Record<string, number>>({})
  const syncBusyRef = useRef<Record<string, boolean>>({})
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

  async function handleSync() {
    const targetRepoId = repo.id
    const token = repo.instanceToken
    if (syncBusyRef.current[targetRepoId]) return
    syncBusyRef.current[targetRepoId] = true
    setSyncBusyByRepo((s) => ({ ...s, [targetRepoId]: true }))
    try {
      await syncAndRefresh(targetRepoId, { token })
    } finally {
      delete syncBusyRef.current[targetRepoId]
      setSyncBusyByRepo((s) => {
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
  const syncBusy = !!syncBusyByRepo[repo.id] || repo.syncing
  const createTip = createBusy
    ? t('action.create-worktree-creating-title', { branch: creatingBranch })
    : t('action.create-worktree-title')

  // Buttons carry their label inline so the adjacent refresh-like glyphs
  // don't make the user guess which action they are invoking.
  return (
    <div className="flex items-center gap-1">
      <Tip label={t('action.fetch-title')}>
        <Button variant="ghost" onClick={handleSync} disabled={syncBusy}>
          <RotateCw className={syncBusy ? 'animate-spin' : ''} />
          {t('action.refresh')}
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
            {t('action.create-worktree')}
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
