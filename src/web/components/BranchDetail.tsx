import { useId } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import {
  getSelectedBranchDetailPresentation,
  type BranchDetailRepo,
  type SelectedBranchDetailPresentation,
} from '#/web/components/branch-detail/model.ts'
import { BranchDetailToolbar } from '#/web/components/branch-detail/BranchDetailToolbar.tsx'
import { BranchDetailContent } from '#/web/components/branch-detail/BranchDetailContent.tsx'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
interface Props {
  repoId: string
  layout?: RepoWorkspaceLayout
  collapsed?: boolean
  detailFocusMode?: boolean
}

// Keep this equality in sync with fields read by BranchDetail children.
function branchDetailRepoEqual(a: BranchDetailRepo | undefined, b: BranchDetailRepo | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.instanceToken === b.instanceToken &&
      a.data.branches === b.data.branches &&
      a.data.currentBranch === b.data.currentBranch &&
      a.data.status === b.data.status &&
      a.data.statusLoaded === b.data.statusLoaded &&
      a.data.worktreesByPath === b.data.worktreesByPath &&
      a.ui.selectedBranch === b.ui.selectedBranch &&
      a.ui.detailTab === b.ui.detailTab &&
      a.resources.status === b.resources.status &&
      a.resources.pullRequests === b.resources.pullRequests &&
      a.operations.branchAction === b.operations.branchAction &&
      a.remote.target === b.remote.target &&
      a.remote.hasRemotes === b.remote.hasRemotes &&
      a.remote.hasBrowserRemote === b.remote.hasBrowserRemote &&
      a.remote.hasGitHubRemote === b.remote.hasGitHubRemote &&
      a.remote.browserRemoteProvider === b.remote.browserRemoteProvider &&
      a.remote.remoteProviders === b.remote.remoteProviders)
  )
}

export function BranchDetail({
  repoId,
  layout = DEFAULT_WORKSPACE_LAYOUT,
  collapsed = false,
  detailFocusMode = false,
}: Props) {
  const detailId = useId()
  const repo = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return repo
        ? {
            id: repo.id,
            instanceToken: repo.instanceToken,
            data: {
              branches: repo.data.branches,
              currentBranch: repo.data.currentBranch,
              status: repo.data.status,
              statusLoaded: repo.data.statusLoaded,
              worktreesByPath: repo.data.worktreesByPath,
            },
            ui: {
              selectedBranch: repo.ui.selectedBranch,
              detailTab: repo.ui.detailTab,
            },
            resources: {
              status: repo.resources.status,
              pullRequests: repo.resources.pullRequests,
            },
            operations: {
              branchAction: repo.operations.branchAction,
            },
            remote: {
              target: repo.remote.target,
              hasRemotes: repo.remote.hasRemotes,
              hasBrowserRemote: repo.remote.hasBrowserRemote,
              hasGitHubRemote: repo.remote.hasGitHubRemote,
              browserRemoteProvider: repo.remote.browserRemoteProvider,
              remoteProviders: repo.remote.remoteProviders,
            },
          }
        : undefined
    },
    branchDetailRepoEqual,
  )
  if (!repo) return null

  const detail = getSelectedBranchDetailPresentation(repo)
  const contentId = `${detailId}-content`

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <BranchDetailWithActions
          key={`${repo.id}:${detail.branch.name}`}
          repo={repo}
          detail={detail}
          branch={detail.branch}
          detailId={detailId}
          contentId={contentId}
          collapsed={collapsed}
          detailFocusMode={detailFocusMode}
          layout={layout}
        />
      ) : (
        <>
          <BranchDetailToolbar
            repo={repo}
            detail={detail}
            detailId={detailId}
            contentId={contentId}
            collapsed={collapsed}
            detailFocusMode={detailFocusMode}
            layout={layout}
          />
          {!collapsed && (
            <BranchDetailContent
              repo={repo}
              detail={detail}
              detailId={detailId}
              contentId={contentId}
              layout={layout}
            />
          )}
        </>
      )}
    </section>
  )
}

interface BranchDetailWithActionsProps {
  repo: BranchDetailRepo
  detail: SelectedBranchDetailPresentation
  branch: NonNullable<SelectedBranchDetailPresentation['branch']>
  detailId: string
  contentId: string
  collapsed: boolean
  detailFocusMode: boolean
  layout: RepoWorkspaceLayout
}

function BranchDetailWithActions({
  repo,
  detail,
  branch,
  detailId,
  contentId,
  collapsed,
  detailFocusMode,
  layout,
}: BranchDetailWithActionsProps) {
  const actions = useBranchActionItems(repo, branch)
  useBranchActionShortcutRegistry(actions)

  return (
    <>
      <BranchDetailToolbar
        repo={repo}
        detail={detail}
        detailId={detailId}
        contentId={contentId}
        collapsed={collapsed}
        detailFocusMode={detailFocusMode}
        layout={layout}
        branchActions={actions}
      />
      {actions.dialogs}
      {!collapsed && (
        <BranchDetailContent repo={repo} detail={detail} detailId={detailId} contentId={contentId} layout={layout} />
      )}
    </>
  )
}
