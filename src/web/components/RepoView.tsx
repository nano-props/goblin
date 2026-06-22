// Active-repo body. The per-repo actions (Refresh, worktree
// filter, new worktree) live in the Topbar — see `Topbar.tsx`
// and `App.tsx` — so the workspace below the topbar is just the
// branch navigator and the branch workspace pane.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoUnavailable } from '#/web/stores/repos/helpers.ts'
import { BranchNavigator } from '#/web/components/BranchNavigator.tsx'
import { BranchWorkspace } from '#/web/components/BranchWorkspace.tsx'
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

const COMPACT_WORKSPACE_TRANSITION_MS = 240

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
        workspacePaneSizes: s.workspacePaneSizes,
      }
    },
    (a, b) =>
      a.exists === b.exists &&
      a.initialLoading === b.initialLoading &&
      a.workspaceFocused === b.workspaceFocused &&
      a.workspacePaneSizes['left-right'] === b.workspacePaneSizes['left-right'],
  )
  const setWorkspacePaneSize = useReposStore((s) => s.setWorkspacePaneSize)
  const repo = useReposStore((s) => s.repos[repoId])
  useRepoToasts(repoId)

  const layout = DEFAULT_WORKSPACE_LAYOUT
  const branchWorkspaceActive = !!repo?.ui.selectedBranch
  const behavior = repoWorkspaceBehavior({
    layout,
    compact,
    workspaceFocused: view.workspaceFocused,
    branchWorkspaceActive,
  })

  const workspacePaneSize = view.workspacePaneSizes[layout]
  const selectedBranch = repo?.ui.selectedBranch ?? null
  const presentedWorkspaceBranch = usePresentedCompactWorkspaceBranch(selectedBranch, compact)

  if (!view.exists || !repo) return <div />
  if (isRepoUnavailable(repo)) return <UnavailableRepoView repo={repo} />
  if (view.initialLoading) {
    return (
      <RepoWorkspaceSkeleton
        layout={layout}
        singlePane={behavior.singlePane}
        singlePaneView={selectedBranch ? 'workspace' : 'navigator'}
        branchWorkspaceState={selectedBranch ? 'content' : 'empty'}
      />
    )
  }

  const singlePane = repo.ui.selectedBranch ? 'workspace' : 'navigator'
  const branchWorkspacePane = (
    <RepoWorkspacePane>
      <BranchWorkspace
        repoId={repoId}
        presentedBranchName={compact ? presentedWorkspaceBranch : undefined}
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
      layout={layout}
      mode="split"
      workspacePaneSize={workspacePaneSize}
      onWorkspacePaneSizeChange={(size) => setWorkspacePaneSize(layout, size)}
      branchNavigatorCollapsed={behavior.branchNavigatorCollapsed}
      branchNavigatorPane={branchNavigatorPane}
      branchWorkspacePane={branchWorkspacePane}
    />
  )

  return <section className="relative flex min-w-0 flex-1 flex-col">{workspaceBody}</section>
}

function CompactRepoWorkspace({
  activePane,
  branchNavigatorPane,
  branchWorkspacePane,
}: {
  activePane: 'navigator' | 'workspace'
  branchNavigatorPane: ReactNode
  branchWorkspacePane: ReactNode
}) {
  const workspaceActive = activePane === 'workspace'

  return (
    <div
      data-compact-workspace=""
      data-active-pane={activePane}
      className="goblin-compact-workspace relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    >
      <div
        data-compact-workspace-pane="navigator"
        aria-hidden={workspaceActive || undefined}
        inert={workspaceActive || undefined}
        className="goblin-compact-workspace__pane goblin-compact-workspace__pane--navigator absolute inset-0 flex min-h-0 min-w-0 bg-background"
      >
        {branchNavigatorPane}
      </div>
      <div
        data-compact-workspace-pane="workspace"
        aria-hidden={!workspaceActive || undefined}
        inert={!workspaceActive || undefined}
        className="goblin-compact-workspace__pane goblin-compact-workspace__pane--workspace absolute inset-0 flex min-h-0 min-w-0 bg-background"
      >
        {branchWorkspacePane}
      </div>
    </div>
  )
}

function usePresentedCompactWorkspaceBranch(selectedBranch: string | null, compact: boolean): string | null {
  const previousBranchRef = useRef<string | null>(selectedBranch)
  const [presentedBranch, setPresentedBranch] = useState<string | null>(selectedBranch)

  useEffect(() => {
    if (!compact) {
      previousBranchRef.current = selectedBranch
      setPresentedBranch(selectedBranch)
      return
    }

    if (selectedBranch) {
      previousBranchRef.current = selectedBranch
      setPresentedBranch(selectedBranch)
      return
    }

    const outgoingBranch = previousBranchRef.current
    if (!outgoingBranch) {
      setPresentedBranch(null)
      return
    }

    setPresentedBranch(outgoingBranch)
    const timeout = window.setTimeout(() => {
      previousBranchRef.current = null
      setPresentedBranch(null)
    }, COMPACT_WORKSPACE_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [compact, selectedBranch])

  return selectedBranch ?? (compact ? presentedBranch : null)
}
