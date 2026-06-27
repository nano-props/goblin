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
interface Props {
  repoId: string
  selectedBranchName?: string | null
  shortcutsEnabled?: boolean
  toolbarTrafficLightOffset?: boolean
}

// Keep this equality in sync with fields read by RepoWorkspace children.
function repoWorkspaceRepoEqual(a: RepoWorkspaceRepo | undefined, b: RepoWorkspaceRepo | undefined): boolean {
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
      a.ui.preferredWorkspacePaneTabByBranch === b.ui.preferredWorkspacePaneTabByBranch &&
      a.ui.workspacePaneTabOrderByBranch === b.ui.workspacePaneTabOrderByBranch &&
      a.ui.lastClosedTabContextByBranch === b.ui.lastClosedTabContextByBranch &&
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
  const repo = useStoreWithEqualityFn(
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
            instanceToken: repo.instanceToken,
            data: {
              branches: repo.data.branches,
              currentBranch: repo.data.currentBranch,
              status: repo.data.status,
              statusLoaded: repo.data.statusLoaded,
              worktreesByPath: repo.data.worktreesByPath,
            },
            ui: {
              selectedBranch,
              preferredWorkspacePaneTabByBranch: repo.ui.preferredWorkspacePaneTabByBranch,
              workspacePaneTabOrderByBranch: repo.ui.workspacePaneTabOrderByBranch,
              lastClosedTabContextByBranch: repo.ui.lastClosedTabContextByBranch,
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
    repoWorkspaceRepoEqual,
  )
  if (!repo) return null

  const detail = getSelectedRepoWorkspacePresentation(repo)

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <BranchShortcutHandler
          key={`${repo.id}:${detail.branch.name}`}
          repo={repo}
          detail={detail}
          branch={detail.branch}
          workspacePaneId={workspacePaneId}
          shortcutsEnabled={shortcutsEnabled}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
        />
      ) : (
        <RepoWorkspacePane
          repo={repo}
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

interface BranchShortcutHandlerProps {
  repo: RepoWorkspaceRepo
  detail: SelectedRepoWorkspacePresentation
  branch: NonNullable<SelectedRepoWorkspacePresentation['branch']>
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset?: boolean
}

function BranchShortcutHandler({
  repo,
  detail,
  branch,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset = false,
}: BranchShortcutHandlerProps) {
  const branchActions = useBranchActions(repo, branch)
  const actions = useBranchActionItems(repo, branch, branchActions)
  useBranchActionShortcutRegistry(actions, shortcutsEnabled)

  return (
    <BranchActionSurfaceContext.Provider value={actions}>
      <RepoWorkspacePane
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        toolbarTrafficLightOffset={toolbarTrafficLightOffset}
        branchActions={branchActions}
      />
    </BranchActionSurfaceContext.Provider>
  )
}
