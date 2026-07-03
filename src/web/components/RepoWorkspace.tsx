import { useId } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  getSelectedRepoWorkspacePresentation,
  type RepoWorkspaceRepo,
  type SelectedRepoWorkspacePresentation,
} from '#/web/components/repo-workspace/model.ts'
import { RepoWorkspaceToolbar } from '#/web/components/repo-workspace/RepoWorkspaceToolbar.tsx'
import { RepoWorkspaceContent } from '#/web/components/repo-workspace/RepoWorkspaceContent.tsx'
import { useRepoWorkspaceTabModel } from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { useBranchActions, type BranchActions } from '#/web/hooks/useBranchActions.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import { useRepoPullRequestsReadModel, useRepoStatusReadModel } from '#/web/repo-data-query.ts'
import { useRepoBranchReadModel } from '#/web/repo-branch-read-model.ts'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
interface Props {
  repoId: string
  selectedBranchName?: string | null
  shortcutsEnabled?: boolean
  toolbarTrafficLightOffset?: boolean
}

// Keep this equality in sync with fields read by RepoWorkspace children.
type RepoWorkspaceRepoShell = Omit<RepoWorkspaceRepo, 'data'>

function repoWorkspaceRepoShellEqual(
  a: RepoWorkspaceRepoShell | undefined,
  b: RepoWorkspaceRepoShell | undefined,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.instanceId === b.instanceId &&
      a.ui.selectedBranch === b.ui.selectedBranch &&
      a.ui.preferredWorkspacePaneTabByTarget === b.ui.preferredWorkspacePaneTabByTarget &&
      a.dataLoads.status === b.dataLoads.status &&
      a.dataLoads.pullRequests === b.dataLoads.pullRequests &&
      a.operations.branchAction === b.operations.branchAction &&
      a.remote.lifecycle === b.remote.lifecycle &&
      a.remote.hasRemotes === b.remote.hasRemotes &&
      a.remote.hasBrowserRemote === b.remote.hasBrowserRemote &&
      a.remote.hasGitHubRemote === b.remote.hasGitHubRemote &&
      a.remote.browserRemoteProvider === b.remote.browserRemoteProvider &&
      a.remote.remoteProviders === b.remote.remoteProviders)
  )
}

export function RepoWorkspace({
  repoId,
  selectedBranchName,
  shortcutsEnabled = true,
  toolbarTrafficLightOffset = false,
}: Props) {
  const workspacePaneId = useId()
  const repoShell = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      const selectedBranch = repo
        ? selectedBranchName === undefined
          ? repo.ui.selectedBranch
          : selectedBranchName
        : null
      return repo
        ? {
            id: repo.id,
            instanceId: repo.instanceId,
            ui: {
              selectedBranch,
              preferredWorkspacePaneTabByTarget: repo.ui.preferredWorkspacePaneTabByTarget,
            },
            dataLoads: {
              status: repo.dataLoads.status,
              pullRequests: repo.dataLoads.pullRequests,
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
    repoWorkspaceRepoShellEqual,
  )
  if (!repoShell) return null

  return (
    <RepoWorkspaceLoaded
      repoShell={repoShell}
      workspacePaneId={workspacePaneId}
      shortcutsEnabled={shortcutsEnabled}
      toolbarTrafficLightOffset={toolbarTrafficLightOffset}
    />
  )
}

function RepoWorkspaceLoaded({
  repoShell,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset,
}: {
  repoShell: RepoWorkspaceRepoShell
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
}) {
  const statusReadModel = useRepoStatusReadModel(repoShell.id, repoShell.instanceId, true)
  const branchReadModel = useRepoBranchReadModel(repoShell.id, repoShell.instanceId, true)
  const selectedBranchName = repoShell.ui.selectedBranch
  const pullRequestsReadModel = useRepoPullRequestsReadModel(
    repoShell.id,
    repoShell.instanceId,
    selectedBranchName ? [selectedBranchName] : undefined,
    'full',
    !!selectedBranchName,
  )
  if (!branchReadModel) {
    return <RepoWorkspaceSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  let presentationData: RepoWorkspaceRepo['data'] = {
    ...branchReadModel,
    status: statusReadModel.data ?? branchReadModel.status,
    statusLoaded: statusReadModel.isSuccess,
  }
  if (selectedBranchName && Array.isArray(pullRequestsReadModel.data)) {
    const pullRequest = pullRequestsReadModel.data.find((entry) => entry.branch === selectedBranchName)?.pullRequest
    presentationData = {
      ...presentationData,
      branches: presentationData.branches.map((branch) => {
        if (branch.name !== selectedBranchName) return branch
        if (pullRequest) return { ...branch, pullRequest }
        const { pullRequest: _pullRequest, ...branchWithoutPullRequest } = branch
        return branchWithoutPullRequest
      }),
    }
  }
  const presentationRepo: RepoWorkspaceRepo = { ...repoShell, data: presentationData }
  const detail = getSelectedRepoWorkspacePresentation(presentationRepo)

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <BranchActionWorkspacePane
          repo={presentationRepo}
          detail={detail}
          branch={detail.branch}
          workspacePaneId={workspacePaneId}
          shortcutsEnabled={shortcutsEnabled}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
        />
      ) : (
        <RepoWorkspacePane
          repo={presentationRepo}
          detail={detail}
          workspacePaneId={workspacePaneId}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
        />
      )}
    </section>
  )
}

interface RepoWorkspacePaneProps {
  repo: RepoWorkspaceRepo
  detail: SelectedRepoWorkspacePresentation
  workspacePaneId: string
  toolbarTrafficLightOffset?: boolean
  branchActions?: BranchActions
}

function RepoWorkspacePane({
  repo,
  detail,
  workspacePaneId,
  toolbarTrafficLightOffset = false,
  branchActions,
}: RepoWorkspacePaneProps) {
  const workspacePaneTabModel = useRepoWorkspaceTabModel(repo, detail)

  return (
    <>
      <RepoWorkspaceToolbar
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        trafficLightOffset={toolbarTrafficLightOffset}
        workspacePaneTabModel={workspacePaneTabModel}
        branchActions={branchActions}
      />
      <RepoWorkspaceContent
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        workspacePaneTabModel={workspacePaneTabModel}
      />
    </>
  )
}

interface BranchActionWorkspacePaneProps {
  repo: RepoWorkspaceRepo
  detail: SelectedRepoWorkspacePresentation
  branch: NonNullable<SelectedRepoWorkspacePresentation['branch']>
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset?: boolean
}

function BranchActionWorkspacePane({
  repo,
  detail,
  branch,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset = false,
}: BranchActionWorkspacePaneProps) {
  const branchActions = useBranchActions(repo, branch)
  const actions = useBranchActionItems(repo, branch, branchActions)
  useBranchActionShortcutRegistry(actions, shortcutsEnabled)

  return (
    <BranchActionSurfaceContext value={actions}>
      <RepoWorkspacePane
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        toolbarTrafficLightOffset={toolbarTrafficLightOffset}
        branchActions={branchActions}
      />
    </BranchActionSurfaceContext>
  )
}
