import { ExternalLink, GitPullRequest } from 'lucide-react'
import { createElement, type ReactNode } from 'react'
import { GitHubOutlineIcon } from '#/web/components/GitHubOutlineIcon.tsx'
import { GitLabLogoIcon } from '#/web/components/GitLabLogoIcon.tsx'
import type { BranchActions } from '#/web/hooks/useBranchActions.tsx'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import type { BrowserRemoteProvider } from '#/web/types.ts'
import { useT } from '#/web/stores/i18n.ts'

export interface RemoteOpenActionItem {
  id: 'remote'
  label: string
  title: string
  ariaLabel: string
  disabled: boolean
  busy: boolean
  visible: boolean
  icon: ReactNode
  onSelect: () => void
}

export function branchBrowserRemoteProvider(
  repo: BranchActionRepo,
  branch: RepoBranchState,
): BrowserRemoteProvider | undefined {
  const providers = repo.remote.remoteProviders
  if (branch.tracking && providers) {
    const remoteName = Object.keys(providers)
      .filter((remote) => branch.tracking === remote || branch.tracking!.startsWith(`${remote}/`))
      .sort((a, b) => b.length - a.length)[0]
    if (remoteName) return providers[remoteName]
  }
  return repo.remote.browserRemoteProvider
}

export function browserRemoteIcon(provider: BrowserRemoteProvider | undefined) {
  if (provider === 'github') return GitHubOutlineIcon
  if (provider === 'gitlab') return GitLabLogoIcon
  return ExternalLink
}

export function useRemoteOpenAction(
  repo: BranchActionRepo,
  branch: RepoBranchState,
  branchActions: BranchActions,
): RemoteOpenActionItem {
  const t = useT()
  const { blocked, busyAction, capabilities, actions } = branchActions
  const pullRequest =
    branch.pullRequest && branchPullRequestBelongsToBranch(branch, branch.pullRequest) ? branch.pullRequest : undefined
  const provider = branchBrowserRemoteProvider(repo, branch)
  const Icon = pullRequest ? GitPullRequest : browserRemoteIcon(provider)
  const label = pullRequest
    ? t('workspace.open-externally.pr', { n: pullRequest.number })
    : t('workspace.open-externally.remote')
  const title = pullRequest ? t('workspace.open-externally.pr-title') : t('workspace.open-externally.remote-title')

  return {
    id: 'remote',
    label,
    title,
    ariaLabel: label,
    disabled: blocked,
    busy: busyAction === 'remote',
    visible: capabilities.canOpenRemote,
    icon: createElement(Icon),
    onSelect: () => {
      void actions.openRemote()
    },
  }
}
