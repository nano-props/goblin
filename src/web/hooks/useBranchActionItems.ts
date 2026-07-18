import { ArrowDown, ArrowUp, Diff, FolderTree, GitBranch, History, Trash2 } from 'lucide-react'
import { createElement, type ReactNode } from 'react'
import type { RepoBranchState } from '#/web/stores/workspaces/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { type BranchActions, type BranchActionItemId } from '#/web/hooks/useBranchActions.tsx'
import {
  branchActionDisplayPhase,
  type BranchActionRepo,
  type BranchCopyPatchAction,
} from '#/web/hooks/branch-action-state.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneBranchTabType, WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { dispatchShowWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
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

export function useBranchActionItems(
  repo: BranchActionRepo,
  branch: RepoBranchState,
  branchActions: BranchActions,
  options: { workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined },
): BranchActionSurface {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const { blocked, busyAction, capabilities, actions } = branchActions
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
  const openStaticWorkspacePaneTab = (type: WorkspacePaneBranchTabType | WorkspacePaneStaticTabType) => {
    void dispatchShowWorkspacePaneStaticTabAction({
      workspaceId: repo.id,
      branchName: branch.name,
      type,
      workspacePaneRoute: options.workspacePaneRoute,
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
      onSelect: () => openStaticWorkspacePaneTab('status'),
    },
    {
      id: 'changes',
      label: t('tab.changes'),
      disabled,
      visible: !!branch.worktree?.path,
      icon: createElement(Diff),
      onSelect: () => openStaticWorkspacePaneTab('changes'),
    },
    {
      id: 'files',
      label: t('tab.files'),
      disabled,
      // Both `changes` and `files` are worktree-scoped tabs
      // (see `WORKSPACE_PANE_STATIC_TAB_SCOPES`), so the menu item
      // is hidden for branches that have no worktree -- mirroring
      // the `changes` gate one entry above. The tab itself is
      // always present on the workspace pane strip; this menu
      // item is a discoverability shortcut for users who don't
      // notice the tab.
      visible: !!branch.worktree?.path,
      icon: createElement(FolderTree),
      onSelect: () => openStaticWorkspacePaneTab('files'),
    },
    {
      id: 'history',
      label: t('tab.log'),
      disabled,
      visible: true,
      icon: createElement(History),
      onSelect: () => openStaticWorkspacePaneTab('history'),
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
