// Toolbar for the branch pane (non-focus mode). Wraps the shared
// RepoToolbar chrome with the branch view-mode control (all /
// worktrees). The section-level slot in focus mode uses BranchInfoBar
// instead.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { BranchViewModeControl } from '#/web/components/repo-toolbar/BranchViewModeControl.tsx'
import { RepoToolbar } from '#/web/components/repo-toolbar/RepoToolbar.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'

interface Props {
  repoId: string
}

export function BranchPaneToolbar({ repoId }: Props) {
  return (
    <RepoToolbar repoId={repoId}>
      <BranchFilterControls repoId={repoId} />
    </RepoToolbar>
  )
}

const BRANCH_FILTER_CONTROLS_EQUAL = (
  a: { branchCount: number; branchViewMode: BranchViewMode },
  b: { branchCount: number; branchViewMode: BranchViewMode },
) => a.branchCount === b.branchCount && a.branchViewMode === b.branchViewMode

function BranchFilterControls({ repoId }: Props) {
  const { branchCount, branchViewMode } = useStoreWithEqualityFn(
    useReposStore,
    (s) => ({
      branchCount: s.repos[repoId]?.data.branches.length ?? 0,
      branchViewMode: s.repos[repoId]?.ui.branchViewMode ?? 'all',
    }),
    BRANCH_FILTER_CONTROLS_EQUAL,
  )
  const setBranchViewMode = useReposStore((s) => s.setBranchViewMode)

  return (
    <BranchViewModeControl
      value={branchViewMode}
      disabled={branchCount === 0}
      onChange={(viewMode) => setBranchViewMode(repoId, viewMode)}
    />
  )
}
