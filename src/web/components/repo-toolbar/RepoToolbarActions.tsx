// Per-repo chrome buttons. These actions sit to the right of the
// repo picker in the Topbar (see `Topbar.tsx`) — they are unrelated
// to any single branch:
//
//   Refresh — see `RepoActivityControl`; syncs configured remotes when
//             present, then rebuilds the local snapshot (branches,
//             status, log) from disk. Local-only repositories skip
//             remote sync and refresh from local reads only.
//   Filter  — single-button toggle for `branchViewMode` (worktrees-only /
//             all). Hidden when the branch navigator is off screen —
//             there is no branch list to filter, so the toggle would
//             just add noise to the topbar.
//   Create  — open the new-worktree dialog. The dialog itself lives in
//             `Layout.MainWindowOverlays` (see `Layout.tsx`) so its
//             form state survives settings navigation — a half-typed
//             branch name is not lost when the user opens Settings
//             and returns. This trigger only fires
//             `LayoutOverlayActions.openCreateWorktree()`.
//
// Branch-scoped operations (Pull / Push / Open in Terminal
// / Open in GitHub) live with the selected-branch workspace, not here —
// those need a branch context to be meaningful.

import { useContext } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { FolderPlus } from 'lucide-react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { RepoActivityControl } from '#/web/components/repo-activity/RepoActivityControl.tsx'
import { BranchViewModeControl } from '#/web/components/repo-toolbar/BranchViewModeControl.tsx'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'
import { useBranchNavigatorVisible } from '#/web/hooks/useBranchNavigatorVisible.ts'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'

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
//
// The visibility check is split into its own component so the
// store-reading hooks in `WorktreeFilterToggle` are never called
// while the button is hidden — keeps the rules of hooks happy
// (consistent hook order across renders) and avoids a needless
// subscription on the rest of the store.
function WorktreeFilterAction({ repoId }: Props) {
  if (!useBranchNavigatorVisible(repoId)) return null
  return <WorktreeFilterToggle repoId={repoId} />
}

function WorktreeFilterToggle({ repoId }: Props) {
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

/**
 * Topbar-mounted trigger for the create-worktree dialog. The dialog
 * itself is rendered by `Layout.MainWindowOverlays`; this component
 * only opens it. Disabled while a `createWorktree` action is in
 * flight on the active repo so the user cannot stack two submissions
 * by hammering the button.
 */
function CreateWorktreeAction({ repoId }: Props) {
  const t = useT()
  const overlayActions = useContext(LayoutOverlayActions)
  const branchAction = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return repo ? repo.operations.branchAction : null
    },
    (a, b) => a === b || (!!a && !!b && a.phase === b.phase && a.reason === b.reason && a.target === b.target),
  )
  const branchActionBusy = branchAction ? branchAction.phase !== 'idle' : true
  const createTip = t('action.create-worktree-title')

  return (
    <Tip label={createTip}>
      <Button
        variant="ghost"
        size="icon-lg"
        onClick={() => {
          if (!branchActionBusy) overlayActions?.openCreateWorktree()
        }}
        disabled={branchActionBusy}
        aria-label={createTip}
      >
        <FolderPlus />
      </Button>
    </Tip>
  )
}