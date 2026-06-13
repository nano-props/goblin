import { ArrowDown, ArrowUp, ClipboardCopy, ExternalLink, GitBranch, GitPullRequest, Trash2 } from 'lucide-react'
import { createElement, type ReactNode } from 'react'
import { GitHubOutlineIcon } from '#/web/components/GitHubOutlineIcon.tsx'
import { GitLabLogoIcon } from '#/web/components/GitLabLogoIcon.tsx'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { EditorAppIcon, TerminalAppIcon } from '#/web/components/ExternalAppIcon/index.tsx'
import { useBranchActions, type BranchActionItemId } from '#/web/hooks/useBranchActions.tsx'
import { branchActionDisplayPhase, type BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { BrowserRemoteProvider } from '#/web/types.ts'
import { useRuntimeExternalAppSettings } from '#/web/runtime-settings-external-apps.ts'
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
  patchItems: BranchActionItem[]
  mainItems: BranchActionItem[]
  destructiveItems: BranchActionItem[]
  dialogs: ReactNode
}

export function visibleBranchActionItems({
  patchItems,
  mainItems,
  destructiveItems,
}: Pick<BranchActionItemGroups, 'patchItems' | 'mainItems' | 'destructiveItems'>): BranchActionItem[] {
  return [...patchItems, ...mainItems, ...destructiveItems].filter((item) => item.visible)
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
  const isRemoteRepo = !!repo.remote.target
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

  const patchItems: BranchActionItem[] = capabilities.canCopyPatch
    ? [
        {
          id: 'copyPatch',
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
    : []

  const mainItems: BranchActionItem[] = [
    {
      id: 'checkout',
      label: branchActionLabel('checkout', 'action.checkout', 'action.checkout-loading', 'action.checkout-queued'),
      disabled,
      busy: busy('checkout'),
      visible: !capabilities.isCurrent && !capabilities.checkedOutInAnotherWorktree,
      shortcut: '↩',
      icon: createElement(GitBranch),
      onSelect: actions.checkout,
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

  return { patchItems, mainItems, destructiveItems, dialogs }
}
