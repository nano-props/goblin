import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  ExternalLink,
  FileText,
  GitBranch,
  GitPullRequest,
  History,
  Trash2,
} from 'lucide-react'
import { createElement, type ReactNode } from 'react'
import { GitHubOutlineIcon } from '#/web/components/GitHubOutlineIcon.tsx'
import { GitLabLogoIcon } from '#/web/components/GitLabLogoIcon.tsx'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import { useT } from '#/web/stores/i18n.ts'
import { EditorAppIcon, TerminalAppIcon } from '#/web/components/ExternalAppIcon/index.tsx'
import { useBranchActions, type BranchActionItemId } from '#/web/hooks/useBranchActions.tsx'
import { branchActionDisplayPhase, type BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { BrowserRemoteProvider } from '#/web/types.ts'
import { useRuntimeExternalAppSettings } from '#/web/runtime-settings-external-apps.ts'
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
  onSelect: () => void | Promise<void>
}

export interface BranchActionItemGroups {
  mainItems: BranchActionItem[]
  destructiveItems: BranchActionItem[]
  dialogs: ReactNode
}

export function visibleBranchActionItems({
  mainItems,
  destructiveItems,
}: Pick<BranchActionItemGroups, 'mainItems' | 'destructiveItems'>): BranchActionItem[] {
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

export function useBranchActionItems(repo: BranchActionRepo, branch: RepoBranchState): BranchActionItemGroups {
  const t = useT()
  const navigation = useMainWindowNavigation()
  const { terminalApp, resolvedTerminalApp, terminalAvailable, editorApp, resolvedEditorApp, editorAvailable } =
    useRuntimeExternalAppSettings()
  const { blocked, busyAction, capabilities, actions, dialogs } = useBranchActions(repo, branch)
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
  const isRemoteRepo = remoteRepoTarget(repo.id, repo.remote.lifecycle) !== null
  // For remote repos the SSH invocation runs on the user's machine, so we
  // don't need the local terminal/editor to be installed — the menu item
  // stays visible regardless of `terminalAvailable` / `editorAvailable`.
  const showTerminalAction = capabilities.canOpenTerminal && (isRemoteRepo || terminalAvailable)
  const showEditorAction = capabilities.canOpenEditor && (isRemoteRepo || editorAvailable)
  const terminalIconPref = isRemoteRepo ? 'auto' : (resolvedTerminalApp ?? terminalApp)
  const editorIconPref = isRemoteRepo ? 'auto' : (resolvedEditorApp ?? editorApp)
  const terminalActionLabelText = (() => {
    if (isRemoteRepo || !resolvedTerminalApp) return t('worktrees.open-in-terminal-label')
    if (resolvedTerminalApp === 'ghostty') return t('settings.terminal.ghostty')
    if (resolvedTerminalApp === 'terminal') return t('settings.terminal.terminal')
    return t('settings.terminal.windows-terminal')
  })()
  const editorActionLabelText = (() => {
    if (isRemoteRepo || !resolvedEditorApp) return t('worktrees.open-in-editor-label')
    if (resolvedEditorApp === 'vscode') return t('settings.editor.vscode')
    if (resolvedEditorApp === 'cursor') return t('settings.editor.cursor')
    return t('settings.editor.windsurf')
  })()

  const openStaticWorkspacePaneView = (type: WorkspacePaneBranchViewType | WorkspacePaneStaticViewType) => {
    openWorkspacePaneView({
      repoId: repo.id,
      branchName: branch.name,
      worktreePath: branch.worktree?.path,
      type,
      navigation,
    })
  }

  const mainItems: BranchActionItem[] = [
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
    ...(capabilities.canCopyPatch
      ? [
          {
            id: 'copyPatch' as const,
            label: t('status.copy-patch'),
            title: t('status.copy-patch-title'),
            ariaLabel: t('status.copy-patch-title'),
            disabled,
            busy: busy('copyPatch'),
            visible: true,
            icon: createElement(ClipboardCopy),
            onSelect: actions.copyPatch,
          },
        ]
      : []),
    ...(showTerminalAction
      ? [
          {
            id: 'terminal' as const,
            label: terminalActionLabelText,
            disabled,
            busy: busy('terminal'),
            visible: true,
            shortcut: 'G',
            icon: createElement(TerminalAppIcon, { pref: terminalIconPref }),
            onSelect: actions.openTerminal,
          },
        ]
      : []),
    ...(showEditorAction
      ? [
          {
            id: 'editor' as const,
            label: editorActionLabelText,
            disabled,
            busy: busy('editor'),
            visible: true,
            shortcut: 'V',
            icon: createElement(EditorAppIcon, { pref: editorIconPref }),
            onSelect: actions.openEditor,
          },
        ]
      : []),
    {
      id: 'remote',
      label: pullRequest ? t('action.remote-pr', { n: pullRequest.number }) : t('action.remote'),
      disabled,
      busy: busy('remote'),
      visible: capabilities.canOpenRemote,
      shortcut: '⇧G',
      icon: createElement(remoteIcon),
      onSelect: actions.openRemote,
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

  return { mainItems, destructiveItems, dialogs }
}
