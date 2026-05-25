// Repo-level chrome buttons. These actions sit here because they are
// unrelated to any single branch:
//
//   Refresh — `git fetch --all --prune` on origin, then rebuilds the
//             local snapshot (branches, status, log) from disk.
//
// Branch-scoped operations (Checkout / Pull / Push / Open in Terminal
// / Open in GitHub) live with the selected-branch detail, not here —
// those need a branch context to be meaningful.

import { useEffect, useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { CreateWorktreeDialog, type CreateWorktreeRequest } from '#/renderer/components/CreateWorktreeDialog.tsx'
import { RepoSyncControl } from '#/renderer/components/repo-sync/RepoSyncControl.tsx'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'

interface Props {
  repo: RepoState
}

export function RepoToolbarActions({ repo }: Props) {
  const t = useT()
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const [createOpen, setCreateOpen] = useState(false)
  const branchActionBusy = resourceBusy(repo.resources.branchAction)

  // RepoView reuses the same React instance across repo switches
  // (no `key={activeId}` on the parent), so RepoToolbarActions keeps
  // its state when the user moves to a different repo. Force-close
  // the create-worktree dialog on repo change so a half-typed branch
  // name from repo A doesn't leak into a submission against repo B.
  useEffect(() => {
    setCreateOpen(false)
  }, [repo.id])

  async function handleCreateWorktree(request: CreateWorktreeRequest) {
    const targetRepoId = repo.id
    const token = repo.instanceToken
    if (branchActionBusy) return
    await runBranchAction(
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

  // Buttons carry their label inline so the adjacent refresh-like glyphs
  // don't make the user guess which action they are invoking.
  return (
    <div className="flex items-center gap-1">
      <RepoSyncControl repo={repo} />
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
      <CreateWorktreeDialog
        open={createOpen}
        repo={repo}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreateWorktree}
      />
    </div>
  )
}
