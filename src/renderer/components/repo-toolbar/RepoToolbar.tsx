import { useStoreWithEqualityFn } from 'zustand/traditional'
import { BranchSearchInput } from '#/renderer/components/repo-toolbar/BranchSearchInput.tsx'
import { BranchViewModeControl } from '#/renderer/components/repo-toolbar/BranchViewModeControl.tsx'
import { RepoToolbarActions } from '#/renderer/components/repo-toolbar/RepoToolbarActions.tsx'
import { WorkspaceLayoutControl } from '#/renderer/components/repo-toolbar/WorkspaceLayoutControl.tsx'
import { Toolbar } from '#/renderer/components/Layout.tsx'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { BranchViewMode } from '#/renderer/stores/repos/types.ts'

interface Props {
  repoId: string
}

export function RepoToolbar({ repoId }: Props) {
  const exists = useReposStore((s) => !!s.repos[repoId])
  if (!exists) return null

  return (
    <Toolbar variant="repo" className="justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <BranchFilterControls repoId={repoId} />
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <RepoToolbarActions repoId={repoId} />
        <WorkspaceLayoutControlConnected />
      </div>
    </Toolbar>
  )
}

function BranchFilterControls({ repoId }: Props) {
  const { branchCount, branchViewMode, branchSearchQuery } = useStoreWithEqualityFn(
    useReposStore,
    (s) => ({
      branchCount: s.repos[repoId]?.data.branches.length ?? 0,
      branchViewMode: s.repos[repoId]?.ui.branchViewMode ?? 'all',
      branchSearchQuery: s.branchSearchQueries[repoId] ?? '',
    }),
    (a, b) =>
      a.branchCount === b.branchCount &&
      a.branchViewMode === b.branchViewMode &&
      a.branchSearchQuery === b.branchSearchQuery,
  )
  const setBranchViewMode = useReposStore((s) => s.setBranchViewMode)
  const setBranchSearchQuery = useReposStore((s) => s.setBranchSearchQuery)

  return (
    <>
      <BranchViewModeControl
        value={branchViewMode as BranchViewMode}
        disabled={branchCount === 0}
        onChange={(viewMode) => setBranchViewMode(repoId, viewMode)}
      />
      <BranchSearchInput
        value={branchSearchQuery}
        disabled={branchCount === 0}
        onChange={(query) => setBranchSearchQuery(repoId, query)}
      />
    </>
  )
}

function WorkspaceLayoutControlConnected() {
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)

  return <WorkspaceLayoutControl value={workspaceLayout} onChange={setWorkspaceLayout} />
}
