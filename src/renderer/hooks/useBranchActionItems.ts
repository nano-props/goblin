import { ArrowDown, ArrowUp, ClipboardCopy, GitBranch, GitPullRequest, Trash2 } from 'lucide-react'
import { createElement, type ReactNode } from 'react'
import { GitHubOutlineIcon } from '#/renderer/components/GitHubOutlineIcon.tsx'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import { EditorAppIcon, TerminalAppIcon } from '#/renderer/components/ExternalAppIcon/index.tsx'
import { useBranchActions, type BranchActionItemId } from '#/renderer/hooks/useBranchActions.tsx'
import { branchPullRequestBelongsToBranch } from '#/shared/git-types.ts'
import type { BranchInfo } from '#/renderer/types.ts'

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

export function useBranchActionItems(repo: RepoState, branch: BranchInfo): BranchActionItemGroups {
  const t = useT()
  const terminalApp = useSettingsStore((s) => s.terminalApp)
  const resolvedTerminalApp = useSettingsStore((s) => s.resolvedTerminalApp)
  const terminalAvailable = useSettingsStore((s) => s.terminalAvailable)
  const editorApp = useSettingsStore((s) => s.editorApp)
  const resolvedEditorApp = useSettingsStore((s) => s.resolvedEditorApp)
  const editorAvailable = useSettingsStore((s) => s.editorAvailable)
  const { blocked, busyAction, capabilities, actions, dialogs } = useBranchActions(repo, branch)
  const disabled = blocked
  const busy = (id: BranchActionItemId) => busyAction === id
  const pullRequest =
    branch.pullRequest && branchPullRequestBelongsToBranch(branch, branch.pullRequest) ? branch.pullRequest : undefined
  const githubIcon = pullRequest ? GitPullRequest : GitHubOutlineIcon

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
      label: t('action.checkout'),
      disabled,
      busy: busy('checkout'),
      visible: !capabilities.isCurrent && !capabilities.checkedOutInAnotherWorktree,
      shortcut: '↩',
      icon: createElement(GitBranch),
      onSelect: actions.checkout,
    },
    {
      id: 'pull',
      label: t('action.pull'),
      disabled,
      busy: busy('pull'),
      visible: capabilities.canPull,
      shortcut: 'P',
      icon: createElement(ArrowDown),
      onSelect: actions.pull,
    },
    {
      id: 'push',
      label: t('action.push'),
      disabled,
      busy: busy('push'),
      visible: capabilities.canPush,
      shortcut: '⇧P',
      icon: createElement(ArrowUp),
      onSelect: actions.push,
    },
    ...(capabilities.canOpenTerminal && terminalAvailable
      ? [
          {
            id: 'terminal' as const,
            label: t('worktrees.open-in-terminal-label'),
            disabled,
            busy: busy('terminal'),
            visible: true,
            shortcut: 'G',
            icon: createElement(TerminalAppIcon, { pref: resolvedTerminalApp ?? terminalApp }),
            onSelect: actions.openTerminal,
          },
        ]
      : []),
    ...(capabilities.canOpenEditor && editorAvailable
      ? [
          {
            id: 'editor' as const,
            label: t('worktrees.open-in-editor-label'),
            disabled,
            busy: busy('editor'),
            visible: true,
            shortcut: 'V',
            icon: createElement(EditorAppIcon, { pref: resolvedEditorApp ?? editorApp }),
            onSelect: actions.openEditor,
          },
        ]
      : []),
    {
      id: 'github',
      label: pullRequest ? t('action.github-pr', { n: pullRequest.number }) : t('action.github'),
      disabled,
      busy: busy('github'),
      visible: capabilities.canOpenGitHub,
      shortcut: '⇧G',
      icon: createElement(githubIcon),
      onSelect: actions.openGitHub,
    },
  ]

  const destructiveItems: BranchActionItem[] = [
    ...(capabilities.canRemoveWorktree
      ? [
          {
            id: 'removeWorktree' as const,
            label: t('action.remove-worktree'),
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
            label: t('action.delete-branch'),
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
