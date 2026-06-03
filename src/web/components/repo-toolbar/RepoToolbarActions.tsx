// Repo-level chrome buttons. These actions sit here because they are
// unrelated to any single branch:
//
//   Refresh — syncs configured remotes when present, then rebuilds the
//             local snapshot (branches, status, log) from disk. Local-only
//             repositories skip remote sync and refresh from local reads only.
//
// Branch-scoped operations (Checkout / Pull / Push / Open in Terminal
// / Open in GitHub) live with the selected-branch detail, not here —
// those need a branch context to be meaningful.

import { useEffect, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { FolderPlus } from 'lucide-react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { CreateWorktreeDialog, type CreateWorktreeRequest } from '#/web/components/CreateWorktreeDialog.tsx'
import { RepoActivityControl } from '#/web/components/repo-activity/RepoActivityControl.tsx'
import type { ExecResult } from '#/shared/git-types.ts'

interface Props {
  repoId: string
}

export function RepoToolbarActions({ repoId }: Props) {
  return (
    <div className="flex items-center gap-1">
      <RepoActivityControl repoId={repoId} />
      <CreateWorktreeAction repoId={repoId} />
    </div>
  )
}

function CreateWorktreeAction({ repoId }: Props) {
  const t = useT()
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const repo = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return repo
        ? {
            id: repo.id,
            instanceToken: repo.instanceToken,
            branchAction: repo.operations.branchAction,
          }
        : null
    },
    (a, b) =>
      a === b ||
      (!!a && !!b && a.id === b.id && a.instanceToken === b.instanceToken && a.branchAction === b.branchAction),
  )
  const [createOpen, setCreateOpen] = useState(false)
  const branchActionBusy = repo ? repo.branchAction.phase !== 'idle' : true

  // RepoView reuses the same React instance across repo switches
  // (no `key={activeId}` on the parent), so RepoToolbarActions keeps
  // its state when the user moves to a different repo. Force-close
  // the create-worktree dialog on repo change so a half-typed branch
  // name from repo A doesn't leak into a submission against repo B.
  useEffect(() => {
    setCreateOpen(false)
  }, [repoId])

  async function handleCreateWorktree(request: CreateWorktreeRequest): Promise<ExecResult | null> {
    if (!repo) return null
    const targetRepoId = repo.id
    const token = repo.instanceToken
    if (branchActionBusy) return null
    return runBranchAction(
      targetRepoId,
      {
        kind: 'createWorktree',
        worktreePath: request.worktreePath,
        newBranch: request.newBranch,
        baseBranch: request.baseBranch,
      },
      { token, refreshOnError: false },
    )
  }

  const createTip = t('action.create-worktree-title')
  if (!repo) return null

  // Buttons carry their label inline so the adjacent refresh-like glyphs
  // don't make the user guess which action they are invoking.
  return (
    <>
      <Tip label={createTip}>
        <span className="inline-flex">
          <Button
            variant="ghost"
            onClick={() => {
              if (!branchActionBusy) setCreateOpen(true)
            }}
            disabled={branchActionBusy}
            aria-label={createTip}
          >
            <FolderPlus />
            {t('action.create-worktree')}
          </Button>
        </span>
      </Tip>
      <CreateWorktreeDialogConnected
        repoId={repoId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreateWorktree}
      />
    </>
  )
}

function CreateWorktreeDialogConnected({
  repoId,
  open,
  onClose,
  onCreate,
}: Props & {
  open: boolean
  onClose: () => void
  onCreate: (request: CreateWorktreeRequest) => ExecResult | null | Promise<ExecResult | null>
}) {
  const repo = useReposStore((s) => s.repos[repoId])
  if (!repo) return null
  return <CreateWorktreeDialog open={open} repo={repo} onClose={onClose} onCreate={onCreate} />
}
