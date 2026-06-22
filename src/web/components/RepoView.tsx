// Active-repo body. The per-repo actions (Refresh, worktree
// filter, new worktree) live in the Topbar — see `Topbar.tsx`
// and `App.tsx` — so the workspace below the topbar is just the
// branch navigator and the branch workspace pane.

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoUnavailable } from '#/web/stores/repos/helpers.ts'
import { BranchNavigator } from '#/web/components/BranchNavigator.tsx'
import { BranchWorkspace } from '#/web/components/BranchWorkspace.tsx'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { CompactRepoWorkspace, RepoWorkspace, RepoWorkspacePane } from '#/web/components/Layout.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { getRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { UnavailableRepoView } from '#/web/components/UnavailableRepoView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'

interface Props {
  repoId: string
}

export function RepoView({ repoId }: Props) {
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const view = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      const presentation = getRepoWorkspacePresentation(repo)
      return {
        exists: presentation.exists,
        initialLoading: presentation.initialLoading,
        workspaceFocused: s.workspaceFocused,
        workspacePaneSize: s.workspacePaneSize,
      }
    },
    (a, b) =>
      a.exists === b.exists &&
      a.initialLoading === b.initialLoading &&
      a.workspaceFocused === b.workspaceFocused &&
      a.workspacePaneSize === b.workspacePaneSize,
  )
  const setWorkspacePaneSize = useReposStore((s) => s.setWorkspacePaneSize)
  const repo = useReposStore((s) => s.repos[repoId])
  useRepoToasts(repoId)

  const branchWorkspaceActive = !!repo?.ui.selectedBranch
  const behavior = repoWorkspaceBehavior({
    compact,
    workspaceFocused: view.workspaceFocused,
    branchWorkspaceActive,
  })

  const workspacePaneSize = view.workspacePaneSize
  const selectedBranch = repo?.ui.selectedBranch ?? null
  const singlePane = selectedBranch ? 'workspace' : 'navigator'
  const compactWorkspaceSelectedBranch = useRetainedValueDuringExit({
    value: selectedBranch,
    active: compact && singlePane === 'workspace',
    retainMs: WORKSPACE_PANE_TRANSITION_MS,
    resetKey: repoId,
  })

  if (!view.exists || !repo) return <div />
  if (isRepoUnavailable(repo)) return <UnavailableRepoView repo={repo} />
  if (view.initialLoading) {
    return (
      <RepoWorkspaceSkeleton
        singlePane={behavior.singlePane}
        singlePaneView={selectedBranch ? 'workspace' : 'navigator'}
        branchWorkspaceState={selectedBranch ? 'content' : 'empty'}
      />
    )
  }

  const branchWorkspacePane = (
    <RepoWorkspacePane>
      <BranchWorkspace
        repoId={repoId}
        selectedBranchName={compact ? compactWorkspaceSelectedBranch : undefined}
        shortcutsEnabled={!compact || singlePane === 'workspace'}
      />
    </RepoWorkspacePane>
  )
  const branchNavigatorPane = (
    <RepoWorkspacePane>
      <BranchNavigator repoId={repoId} showActions={behavior.branchNavigatorActionsVisible} />
    </RepoWorkspacePane>
  )
  const singlePaneBody = singlePane === 'workspace' ? branchWorkspacePane : branchNavigatorPane

  const workspaceBody = compact ? (
    <CompactRepoWorkspace
      activePane={singlePane}
      branchNavigatorPane={branchNavigatorPane}
      branchWorkspacePane={branchWorkspacePane}
    />
  ) : behavior.singlePane ? (
    singlePaneBody
  ) : (
    <RepoWorkspace
      mode="split"
      workspacePaneSize={workspacePaneSize}
      onWorkspacePaneSizeChange={setWorkspacePaneSize}
      branchNavigatorCollapsed={behavior.branchNavigatorCollapsed}
      branchNavigatorPane={branchNavigatorPane}
      branchWorkspacePane={branchWorkspacePane}
    />
  )

  return <section className="relative flex min-w-0 flex-1 flex-col">{workspaceBody}</section>
}
