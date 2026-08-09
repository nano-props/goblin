import { ArrowDown, ArrowUp, Diff, FolderTree, GitBranch, History, Trash2 } from '@lucide/vue'
import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, VNodeChild } from 'vue'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { BranchActions } from '#/web/hooks/useBranchActions.tsx'
import {
  branchActionDisplayPhase,
  type BranchActionItemId,
  type BranchActionRepo,
  type BranchCopyPatchAction,
} from '#/web/hooks/branch-action-state.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
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
  icon: VNodeChild
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
  repo: MaybeRefOrGetter<BranchActionRepo>,
  branch: MaybeRefOrGetter<BranchSnapshotInfo>,
  branchActions: MaybeRefOrGetter<BranchActions>,
  options: { workspacePaneRoute: MaybeRefOrGetter<ParsedWorkspacePaneRoute | null | undefined> },
): ComputedRef<BranchActionSurface> {
  const t = useT()
  const navigation = useAppNavigation()
  return computed(() => {
    const currentRepo = toValue(repo)
    const currentBranch = toValue(branch)
    const { blocked, busyAction, capabilities, actions } = toValue(branchActions)
    const busy = (id: BranchActionItemId) => busyAction === id
    const phase = branchActionDisplayPhase(currentRepo, currentBranch.name)
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
        workspaceId: currentRepo.id,
        branchName: currentBranch.name,
        type,
        workspacePaneRoute: toValue(options.workspacePaneRoute),
        navigation,
      })
    }
    const copyPatchAction: BranchCopyPatchAction = {
      label: t('status.copy-patch'),
      title: t('status.copy-patch-title'),
      disabled: blocked,
      busy: busy('copyPatch'),
      visible: capabilities.canCopyPatch,
      onSelect: actions.copyPatch,
    }
    const mainItems: BranchActionItem[] = [
      {
        id: 'pull',
        label: branchActionLabel('pull', 'action.pull', 'action.pull-loading', 'action.pull-queued'),
        disabled: blocked,
        busy: busy('pull'),
        visible: capabilities.canPull,
        shortcut: 'P',
        icon: <ArrowDown />,
        onSelect: actions.pull,
      },
      {
        id: 'push',
        label: branchActionLabel('push', 'action.push', 'action.push-loading', 'action.push-queued'),
        disabled: blocked,
        busy: busy('push'),
        visible: capabilities.canPush,
        shortcut: '⇧P',
        icon: <ArrowUp />,
        onSelect: actions.push,
      },
      {
        id: 'status',
        label: t('tab.status'),
        disabled: blocked,
        visible: true,
        icon: <GitBranch />,
        onSelect: () => openStaticWorkspacePaneTab('status'),
      },
      {
        id: 'changes',
        label: t('tab.changes'),
        disabled: blocked,
        visible: !!currentBranch.worktree?.path,
        icon: <Diff />,
        onSelect: () => openStaticWorkspacePaneTab('changes'),
      },
      {
        id: 'files',
        label: t('tab.files'),
        disabled: blocked,
        // Both `changes` and `files` are worktree-scoped tabs
        // (see `WORKSPACE_PANE_STATIC_TAB_SCOPES`), so the menu item
        // is hidden for branches that have no worktree -- mirroring
        // the `changes` gate one entry above. The tab itself is
        // always present on the workspace pane strip; this menu
        // item is a discoverability shortcut for users who don't
        // notice the tab.
        visible: !!currentBranch.worktree?.path,
        icon: <FolderTree />,
        onSelect: () => openStaticWorkspacePaneTab('files'),
      },
      {
        id: 'history',
        label: t('tab.log'),
        disabled: blocked,
        visible: true,
        icon: <History />,
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
              disabled: blocked,
              busy: busy('removeWorktree'),
              visible: true,
              destructive: true,
              icon: <Trash2 />,
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
              disabled: blocked,
              busy: busy('deleteBranch'),
              visible: true,
              destructive: true,
              icon: <Trash2 />,
              onSelect: actions.requestDeleteBranch,
            },
          ]
        : []),
    ]

    return { mainItems, destructiveItems, copyPatchAction }
  })
}
