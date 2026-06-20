// Per-repo chrome buttons. These actions sit to the right of the
// repo tabs in the Topbar (see `Topbar.tsx`) — they are unrelated
// to any single branch:
//
//   Refresh — syncs configured remotes when present, then rebuilds the
//             local snapshot (branches, status, log) from disk. Local-only
//             repositories skip remote sync and refresh from local reads only.
//   Filter  — single-button toggle for `branchViewMode` (worktrees-only /
//             all), using the same topbar icon-button treatment as the
//             surrounding controls.
//   Create  — open the new-worktree dialog for the active repo.
//
// Branch-scoped operations (Pull / Push / Open in Terminal
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
import { BranchViewModeControl } from '#/web/components/repo-toolbar/BranchViewModeControl.tsx'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'

interface Props {
  repoId: string
}

export function RepoToolbarActions({ repoId }: Props) {
  // Render the three actions as direct children (no wrapper) so
  // they pick up the parent topbar's `gap-2`. Wrapping them in a
  // flex container with its own smaller `gap-1` made the spacing
  // between the actions visibly tighter than the gap from the
  // last action to the Settings button — the four topbar buttons
  // should read as one row of equally-spaced peers.
  return (
    <>
      <RepoActivityControl repoId={repoId} />
      <WorktreeFilterAction repoId={repoId} />
      <CreateWorktreeAction repoId={repoId} />
    </>
  )
}

// Reads the worktree-filter state from the repos store and feeds it
// into the BranchViewModeControl toggle. Sits between Refresh and
// CreateWorktree in the topbar, the visual grouping is implied by
// the row order rather than a separate flex container.
function WorktreeFilterAction({ repoId }: Props) {
  const setBranchViewMode = useReposStore((s) => s.setBranchViewMode)
  const { branchCount, branchViewMode } = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return {
        branchCount: repo?.data.branches.length ?? 0,
        branchViewMode: repo?.ui.branchViewMode ?? 'all',
      }
    },
    (a, b) => a.branchCount === b.branchCount && a.branchViewMode === b.branchViewMode,
  )
  return (
    <BranchViewModeControl
      value={branchViewMode}
      disabled={branchCount === 0}
      onChange={(viewMode: BranchViewMode) => setBranchViewMode(repoId, viewMode)}
    />
  )
}

function CreateWorktreeAction({ repoId }: Props) {
  const t = useT()
  const submitBranchAction = useReposStore((s) => s.submitBranchAction)
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

  function handleCreateWorktree(request: CreateWorktreeRequest): void {
    if (!repo) return
    const targetRepoId = repo.id
    const token = repo.instanceToken
    if (branchActionBusy) return
    submitBranchAction(
      targetRepoId,
      {
        kind: 'createWorktree',
        input: request.input,
      },
      { token, refreshOnError: false },
    )
  }

  const createTip = t('action.create-worktree-title')
  if (!repo) return null

  return (
    <>
      <Tip label={createTip}>
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={() => {
            if (!branchActionBusy) setCreateOpen(true)
          }}
          disabled={branchActionBusy}
          aria-label={createTip}
        >
          <FolderPlus />
        </Button>
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
  onCreate: (request: CreateWorktreeRequest) => void | Promise<void>
}) {
  const repo = useReposStore((s) => s.repos[repoId])
  if (!repo) return null
  return <CreateWorktreeDialog open={open} repo={repo} onClose={onClose} onCreate={onCreate} />
}
