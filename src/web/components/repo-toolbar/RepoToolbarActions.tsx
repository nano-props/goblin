import { useContext } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { GitBranchPlus, LayoutDashboard } from 'lucide-react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { RepoActivityControl } from '#/web/components/repo-activity/RepoActivityControl.tsx'
import { BranchViewModeControl } from '#/web/components/repo-toolbar/BranchViewModeControl.tsx'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'
import { LayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { InlineShortcut } from '#/web/components/InlineShortcut.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { formatAccelerator } from '#/shared/accelerator.ts'
import { CREATE_WORKTREE_SHORTCUT } from '#/shared/shortcut-definitions.ts'
import { useRepoBranchReadModel } from '#/web/repo-branch-read-model.ts'
import { useRepoOperationsReadModel } from '#/web/repo-data-query.ts'
import { branchActionOperationFromServer } from '#/web/hooks/branch-action-state.ts'

interface Props {
  repoId: string
}

interface CreateWorktreeRowActionProps extends Props {
  selected?: boolean
  onCreateWorktree?: () => void
}

interface DashboardRowActionProps extends Props {
  selected?: boolean
  onOpenDashboard?: () => void
}

export function RepoSyncAction({ repoId }: Props) {
  return <RepoActivityControl repoId={repoId} />
}

export function BranchFilterAction({ repoId }: Props) {
  return <WorktreeFilterToggle repoId={repoId} />
}

export function DashboardRowAction({ selected = false, onOpenDashboard }: DashboardRowActionProps) {
  const t = useT()
  return (
    <SidebarRowButton
      onClick={() => onOpenDashboard?.()}
      aria-label={t('repo.dashboard')}
      size="dense"
      selected={selected}
      leading={<LayoutDashboard size={16} />}
    >
      {t('repo.dashboard')}
    </SidebarRowButton>
  )
}

function WorktreeFilterToggle({ repoId }: Props) {
  const setBranchViewMode = useReposStore((s) => s.setBranchViewMode)
  const repoView = useReposStore(
    useShallow((s) => {
      const repo = s.repos[repoId]
      return {
        id: repo?.id ?? '',
        instanceId: repo?.instanceId ?? '',
        branchViewMode: repo?.ui.branchViewMode ?? 'all',
        exists: !!repo,
      }
    }),
  )
  const branchReadModel = useRepoBranchReadModel(repoView.id, repoView.instanceId, repoView.exists)
  return (
    <BranchViewModeControl
      value={repoView.branchViewMode}
      disabled={!branchReadModel || branchReadModel.branches.length === 0}
      onChange={(viewMode: BranchViewMode) => setBranchViewMode(repoId, viewMode)}
    />
  )
}

export function CreateWorktreeRowAction({
  repoId,
  selected = false,
  onCreateWorktree: routeCreateWorktree,
}: CreateWorktreeRowActionProps) {
  const t = useT()
  const { disabled, openCreateWorktree } = useCreateWorktreeTrigger(repoId)
  const label = t('action.create-worktree-title')
  const shortcutLabel = formatAccelerator(CREATE_WORKTREE_SHORTCUT)

  return (
    <SidebarRowButton
      onClick={() => {
        if (disabled) return
        if (routeCreateWorktree) routeCreateWorktree()
        else openCreateWorktree()
      }}
      disabled={disabled}
      selected={selected}
      aria-label={`${label} (${shortcutLabel})`}
      data-testid="create-worktree-button"
      size="dense"
      className="group"
      leading={<GitBranchPlus size={16} />}
      trailing={<InlineShortcut shortcut={shortcutLabel} showOnHover={true} aria-hidden={true} />}
    >
      {label}
    </SidebarRowButton>
  )
}

function useCreateWorktreeTrigger(repoId: string) {
  const overlayActions = useContext(LayoutOverlayActions)
  const repoShell = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return repo
        ? {
            id: repo.id,
            instanceId: repo.instanceId,
            branchAction: repo.operations.branchAction,
          }
        : null
    },
    (a, b) =>
      a === b ||
      (!!a &&
        !!b &&
        a.id === b.id &&
        a.instanceId === b.instanceId &&
        a.branchAction.phase === b.branchAction.phase &&
        a.branchAction.reason === b.branchAction.reason &&
        a.branchAction.target === b.branchAction.target),
  )
  const operationsReadModel = useRepoOperationsReadModel(repoShell?.id ?? '', repoShell?.instanceId ?? '', {
    enabled: !!repoShell,
  })
  const branchAction = repoShell
    ? branchActionOperationFromServer(repoShell.branchAction, operationsReadModel.data?.operations)
    : null
  const branchActionBusy = branchAction ? branchAction.phase !== 'idle' : true
  return {
    disabled: branchActionBusy,
    openCreateWorktree: () => overlayActions?.openCreateWorktree(),
  }
}
