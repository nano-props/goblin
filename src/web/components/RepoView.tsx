// Active-repo body. The per-repo actions (Refresh, worktree
// filter, new worktree) live in the Topbar — see `Topbar.tsx`
// and `App.tsx` — so the workspace below the topbar is just the
// branch list and the workspace pane.

import { useEffect, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoUnavailable } from '#/web/stores/repos/helpers.ts'
import { BranchList } from '#/web/components/BranchList.tsx'
import { BranchDetail } from '#/web/components/BranchDetail.tsx'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { RepoWorkspace, RepoWorkspacePane } from '#/web/components/Layout.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { getRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { UnavailableRepoView } from '#/web/components/UnavailableRepoView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

interface Props {
  repoId: string
}

type CompactWorkspacePane = 'branch' | 'workspace'

export function RepoView({ repoId }: Props) {
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const [compactPane, setCompactPane] = useState<CompactWorkspacePane>('branch')
  const view = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      const presentation = getRepoWorkspacePresentation(repo)
      return {
        exists: presentation.exists,
        initialLoading: presentation.initialLoading,
        branchListPaneVisible: s.branchListPaneVisible,
        workspacePaneSizes: s.workspacePaneSizes,
      }
    },
    (a, b) =>
      a.exists === b.exists &&
      a.initialLoading === b.initialLoading &&
      a.branchListPaneVisible === b.branchListPaneVisible &&
      a.workspacePaneSizes['left-right'] === b.workspacePaneSizes['left-right'],
  )
  const setWorkspacePaneSize = useReposStore((s) => s.setWorkspacePaneSize)
  const repo = useReposStore((s) => s.repos[repoId])
  useRepoToasts(repoId)

  useEffect(() => {
    if (compact) setCompactPane('branch')
  }, [compact, repoId])

  const layout = DEFAULT_WORKSPACE_LAYOUT
  const branchListPaneVisible = compact ? true : view.branchListPaneVisible
  const behavior = repoWorkspaceBehavior(layout, branchListPaneVisible)
  const workspacePaneSize = view.workspacePaneSizes[layout]

  if (!view.exists || !repo) return <div />
  if (isRepoUnavailable(repo)) return <UnavailableRepoView repo={repo} />
  if (view.initialLoading) {
    return <RepoWorkspaceSkeleton layout={layout} branchListPaneVisible={branchListPaneVisible} />
  }

  const workspacePane = (
    <RepoWorkspacePane>
      <BranchDetail
        repoId={repoId}
        layout={layout}
        onBack={compact ? () => setCompactPane('branch') : undefined}
      />
    </RepoWorkspacePane>
  )
  const branchPane = (
    <RepoWorkspacePane>
      <BranchList
        repoId={repoId}
        showActions={behavior.branchListActionsVisible}
        onBranchActivated={compact ? () => setCompactPane('workspace') : undefined}
      />
    </RepoWorkspacePane>
  )

  const compactWorkspaceBody = compactPane === 'workspace' ? workspacePane : branchPane

  const workspaceBody =
    compact ? (
      compactWorkspaceBody
    ) : (
      <RepoWorkspace
        layout={layout}
        mode={behavior.mode}
        workspacePaneSize={workspacePaneSize}
        onWorkspacePaneSizeChange={(size) => setWorkspacePaneSize(layout, size)}
        branchPane={branchPane}
        workspacePane={workspacePane}
      />
    )

  return (
    <section className="relative flex min-w-0 flex-1 flex-col">
      {workspaceBody}
    </section>
  )
}
