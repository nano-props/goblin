import { ArrowDown, ArrowUp, ExternalLink, FileText, GitBranch, GitPullRequest, History, Trash2 } from 'lucide-react'
import { createElement, type ReactNode } from 'react'
import { GitHubOutlineIcon } from '#/web/components/GitHubOutlineIcon.tsx'
import { GitLabLogoIcon } from '#/web/components/GitLabLogoIcon.tsx'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useBranchActions, type BranchActionItemId } from '#/web/hooks/useBranchActions.tsx'
import {
  branchActionDisplayPhase,
  type BranchActionRepo,
  type BranchCopyPatchAction,
} from '#/web/hooks/branch-action-state.ts'
import { branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { BrowserRemoteProvider } from '#/web/types.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneBranchViewType, WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'
import { openWorkspacePaneView } from '#/web/components/branch-workspace/open-workspace-pane-view.ts'
export interface BranchActionItem {
  id: BranchActionItemId
  label: string
  title?: string
  ariaLabel?: string
  disabled: boolean
  busy?: boolean
  visible: boolean
  destructive?: boolean
  shortcut?: string
  icon: ReactNode
  // Actions return either a dispatcher promise or nothing — the menu and
  // shortcut registry both discard the value. The widget's wider variant
  // lives on `BranchCopyPatchAction` so it can inspect the boolean outcome.
  onSelect: () => void | Promise<void>
}

export interface BranchActionSurface {
  mainItems: BranchActionItem[]
  destructiveItems: BranchActionItem[]
  copyPatchAction: BranchCopyPatchAction
}

export function visibleBranchActionItems({
  mainItems,
  destructiveItems,
}: Pick<BranchActionSurface, 'mainItems' | 'destructiveItems'>): BranchActionItem[] {
  return [...mainItems, ...destructiveItems].filter((item) => item.visible)
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

function browserRemoteIcon(provider: BrowserRemoteProvider | undefined) {
  if (provider === 'github') return GitHubOutlineIcon
  if (provider === 'gitlab') return GitLabLogoIcon
  return ExternalLink
}

export function useBranchActionItems(repo: BranchActionRepo, branch: RepoBranchState): BranchActionSurface {
  const t = useT()
  const navigation = useMainWindowNavigation()
  const { blocked, busyAction, capabilities, actions } = useBranchActions(repo, branch)
  const disabled = blocked
  const busy = (id: BranchActionItemId) => busyAction === id
  const phase = branchActionDisplayPhase(repo, branch.name)
  const branchActionLabel = (
    id: BranchActionItemId,
    idleKey: string,
    loadingKey: string,
    queuedKey?: string,
  ): string => {
    if (!busy(id)) return t(idleKey)
    if (phase === 'queued' && queuedKey) return t(queuedKey)
    return t(loadingKey)
  }
  const pullRequest =
    branch.pullRequest && branchPullRequestBelongsToBranch(branch, branch.pullRequest) ? branch.pullRequest : undefined
  const remoteIcon = pullRequest ? GitPullRequest : browserRemoteIcon(branchBrowserRemoteProvider(repo, branch))
  const openStaticWorkspacePaneView = (type: WorkspacePaneBranchViewType | WorkspacePaneStaticViewType) => {
    void openWorkspacePaneView({
      repoId: repo.id,
      branchName: branch.name,
      worktreePath: branch.worktree?.path,
      type,
      navigation,
    })
  }

  const copyPatchAction: BranchCopyPatchAction = {
    label: t('status.copy-patch'),
    title: t('status.copy-patch-title'),
    disabled,
    busy: busy('copyPatch'),
    visible: capabilities.canCopyPatch,
    onSelect: actions.copyPatch,
  }

  const mainItems: BranchActionItem[] = [
    {
      id: 'pull',
      label: branchActionLabel('pull', 'action.pull', 'action.pull-loading', 'action.pull-queued'),
      disabled,
      busy: busy('pull'),
      visible: capabilities.canPull,
      shortcut: 'P',
      icon: createElement(ArrowDown),
      onSelect: actions.pull,
    },
    {
      id: 'push',
      label: branchActionLabel('push', 'action.push', 'action.push-loading', 'action.push-queued'),
      disabled,
      busy: busy('push'),
      visible: capabilities.canPush,
      shortcut: '⇧P',
      icon: createElement(ArrowUp),
      onSelect: actions.push,
    },
    {
      id: 'status',
      label: t('tab.status'),
      disabled,
      visible: true,
      icon: createElement(GitBranch),
      onSelect: () => openStaticWorkspacePaneView('status'),
    },
    {
      id: 'history',
      label: t('tab.log'),
      disabled,
      visible: true,
      icon: createElement(History),
      onSelect: () => openStaticWorkspacePaneView('history'),
    },
    {
      id: 'changes',
      label: t('tab.changes'),
      disabled,
      visible: !!branch.worktree?.path,
      icon: createElement(FileText),
      onSelect: () => openStaticWorkspacePaneView('changes'),
    },
    {
      id: 'remote',
      label: pullRequest ? t('action.remote-pr', { n: pullRequest.number }) : t('action.remote'),
      disabled,
      busy: busy('remote'),
      visible: capabilities.canOpenRemote,
      shortcut: '⇧G',
      icon: createElement(remoteIcon),
      onSelect: () => {
        void actions.openRemote()
      },
    },
  ]

  const destructiveItems: BranchActionItem[] = [
    ...(capabilities.canRemoveWorktree
      ? [
          {
            id: 'removeWorktree' as const,
            label: branchActionLabel(
              'removeWorktree',
              'action.remove-worktree',
              'action.remove-worktree-removing-title',
              'action.remove-worktree-queued-title',
            ),
            disabled,
            busy: busy('removeWorktree'),
            visible: true,
            destructive: true,
            icon: createElement(Trash2),
            onSelect: actions.requestRemoveWorktree,
          },
        ]
      : []),
    ...(capabilities.isRegularBranch
      ? [
          {
            id: 'deleteBranch' as const,
            label: branchActionLabel(
              'deleteBranch',
              'action.delete-branch',
              'action.delete-branch-deleting-title',
              'action.delete-branch-queued-title',
            ),
            disabled,
            busy: busy('deleteBranch'),
            visible: true,
            destructive: true,
            icon: createElement(Trash2),
            onSelect: actions.requestDeleteBranch,
          },
        ]
      : []),
  ]

  return { mainItems, destructiveItems, copyPatchAction }
}
