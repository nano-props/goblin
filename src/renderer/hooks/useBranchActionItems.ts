import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  Code2,
  ExternalLink,
  GitBranch,
  Terminal,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { RepoState } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { useBranchActions, type BranchActionOp } from '#/renderer/hooks/useBranchActions.tsx'
import type { BranchInfo } from '#/renderer/types.ts'

export interface BranchActionItem {
  id: BranchActionOp
  label: string
  title?: string
  ariaLabel?: string
  disabled: boolean
  visible: boolean
  destructive?: boolean
  Icon: LucideIcon
  onSelect: () => void
}

export interface BranchActionItemGroups {
  busy: BranchActionOp | null
  patchItems: BranchActionItem[]
  mainItems: BranchActionItem[]
  destructiveItems: BranchActionItem[]
  dialogs: ReactNode
}

export function useBranchActionItems(
  repo: RepoState,
  branch: BranchInfo,
  ghosttyInstalled: boolean,
  vscodeInstalled: boolean,
): BranchActionItemGroups {
  const t = useT()
  const { busy, capabilities, actions, dialogs } = useBranchActions(repo, branch)

  const patchItems: BranchActionItem[] = capabilities.canCopyPatch
    ? [
        {
          id: 'copyPatch',
          label: t('status.copyPatch'),
          title: t('status.copyPatchTitle'),
          ariaLabel: t('status.copyPatchTitle'),
          disabled: !!busy,
          visible: true,
          Icon: ClipboardCopy,
          onSelect: actions.copyPatch,
        },
      ]
    : []

  const mainItems: BranchActionItem[] = [
    {
      id: 'checkout',
      label: t('action.checkout'),
      disabled: !!busy,
      visible: !capabilities.isCurrent && !capabilities.checkedOutInAnotherWorktree,
      Icon: GitBranch,
      onSelect: actions.checkout,
    },
    {
      id: 'pull',
      label: t('action.pull'),
      disabled: !!busy,
      visible: capabilities.canPull,
      Icon: ArrowDown,
      onSelect: actions.pull,
    },
    {
      id: 'push',
      label: t('action.push'),
      disabled: !!busy,
      visible: true,
      Icon: ArrowUp,
      onSelect: actions.push,
    },
    ...(capabilities.canOpenGhostty && ghosttyInstalled
      ? [
          {
            id: 'ghostty' as const,
            label: t('worktrees.openInGhosttyLabel'),
            disabled: !!busy,
            visible: true,
            Icon: Terminal,
            onSelect: actions.openGhostty,
          },
        ]
      : []),
    ...(capabilities.canOpenVSCode && vscodeInstalled
      ? [
          {
            id: 'vscode' as const,
            label: t('worktrees.openInVSCodeLabel'),
            disabled: !!busy,
            visible: true,
            Icon: Code2,
            onSelect: actions.openVSCode,
          },
        ]
      : []),
    {
      id: 'github',
      label: t('action.github'),
      disabled: !!busy,
      visible: true,
      Icon: ExternalLink,
      onSelect: actions.openGitHub,
    },
  ]

  const destructiveItems: BranchActionItem[] = [
    ...(capabilities.canRemoveWorktree
      ? [
          {
            id: 'removeWorktree' as const,
            label: t('action.removeWorktree'),
            disabled: !!busy,
            visible: true,
            destructive: true,
            Icon: Trash2,
            onSelect: actions.requestRemoveWorktree,
          },
        ]
      : []),
    ...(capabilities.isRegularBranch
      ? [
          {
            id: 'deleteBranch' as const,
            label: t('action.deleteBranch'),
            disabled: !!busy,
            visible: true,
            destructive: true,
            Icon: Trash2,
            onSelect: actions.requestDeleteBranch,
          },
        ]
      : []),
  ]

  return { busy, patchItems, mainItems, destructiveItems, dialogs }
}
