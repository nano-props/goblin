import { useId } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  getSelectedBranchWorkspacePresentation,
  type BranchWorkspaceRepo,
  type SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import { BranchWorkspaceToolbar } from '#/web/components/branch-workspace/BranchWorkspaceToolbar.tsx'
import { BranchWorkspaceContent } from '#/web/components/branch-workspace/BranchWorkspaceContent.tsx'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
interface Props {
  repoId: string
}

// Keep this equality in sync with fields read by BranchWorkspace children.
function branchWorkspaceRepoEqual(a: BranchWorkspaceRepo | undefined, b: BranchWorkspaceRepo | undefined): boolean {
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
      a.ui.preferredWorkspacePaneView === b.ui.preferredWorkspacePaneView &&
      a.ui.openBranchWorkspacePaneViewsByBranch === b.ui.openBranchWorkspacePaneViewsByBranch &&
      a.resources.status === b.resources.status &&
      a.resources.pullRequests === b.resources.pullRequests &&
      a.operations.branchAction === b.operations.branchAction &&
      a.remote.lifecycle === b.remote.lifecycle &&
      a.remote.hasRemotes === b.remote.hasRemotes &&
      a.remote.hasBrowserRemote === b.remote.hasBrowserRemote &&
      a.remote.hasGitHubRemote === b.remote.hasGitHubRemote &&
      a.remote.browserRemoteProvider === b.remote.browserRemoteProvider &&
      a.remote.remoteProviders === b.remote.remoteProviders)
  )
}

export function BranchWorkspace({ repoId }: Props) {
  const workspacePaneId = useId()
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
              preferredWorkspacePaneView: repo.ui.preferredWorkspacePaneView,
              openBranchWorkspacePaneViewsByBranch: repo.ui.openBranchWorkspacePaneViewsByBranch,
            },
            resources: {
              status: repo.resources.status,
              pullRequests: repo.resources.pullRequests,
            },
            operations: {
              branchAction: repo.operations.branchAction,
            },
            remote: {
              lifecycle: repo.remote.lifecycle,
              hasRemotes: repo.remote.hasRemotes,
              hasBrowserRemote: repo.remote.hasBrowserRemote,
              hasGitHubRemote: repo.remote.hasGitHubRemote,
              browserRemoteProvider: repo.remote.browserRemoteProvider,
              remoteProviders: repo.remote.remoteProviders,
            },
          }
        : undefined
    },
    branchWorkspaceRepoEqual,
  )
  if (!repo) return null

  const detail = getSelectedBranchWorkspacePresentation(repo)

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <BranchShortcutHandler
          key={`${repo.id}:${detail.branch.name}`}
          repo={repo}
          detail={detail}
          branch={detail.branch}
          workspacePaneId={workspacePaneId}
        />
      ) : (
        <>
          <BranchWorkspaceToolbar
            repo={repo}
            detail={detail}
            workspacePaneId={workspacePaneId}
          />
          <BranchWorkspaceContent
            repo={repo}
            detail={detail}
            workspacePaneId={workspacePaneId}
          />
        </>
      )}
    </section>
  )
}

interface BranchShortcutHandlerProps {
  repo: BranchWorkspaceRepo
  detail: SelectedBranchWorkspacePresentation
  branch: NonNullable<SelectedBranchWorkspacePresentation['branch']>
  workspacePaneId: string
}

function BranchShortcutHandler({ repo, detail, branch, workspacePaneId }: BranchShortcutHandlerProps) {
  const actions = useBranchActionItems(repo, branch)
  useBranchActionShortcutRegistry(actions)

  return (
    <>
      <BranchWorkspaceToolbar repo={repo} detail={detail} workspacePaneId={workspacePaneId} />
      {actions.dialogs}
      <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId={workspacePaneId} />
    </>
  )
}
