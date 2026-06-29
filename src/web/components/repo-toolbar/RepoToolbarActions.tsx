import { useContext } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { FolderPlus } from 'lucide-react'
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

interface Props {
  repoId: string
}

export function RepoSyncAction({ repoId }: Props) {
  return <RepoActivityControl repoId={repoId} />
}

export function BranchFilterAction({ repoId }: Props) {
  return <WorktreeFilterToggle repoId={repoId} />
}

function WorktreeFilterToggle({ repoId }: Props) {
  const setBranchViewMode = useReposStore((s) => s.setBranchViewMode)
  const { branchCount, branchViewMode } = useReposStore(
    useShallow((s) => {
      const repo = s.repos[repoId]
      return {
        branchCount: repo?.data.branches.length ?? 0,
        branchViewMode: repo?.ui.branchViewMode ?? 'all',
      }
    }),
  )
  return (
    <BranchViewModeControl
      value={branchViewMode}
      disabled={branchCount === 0}
      onChange={(viewMode: BranchViewMode) => setBranchViewMode(repoId, viewMode)}
    />
  )
}

export function CreateWorktreeRowAction({ repoId }: Props) {
  const t = useT()
  const { disabled, openCreateWorktree } = useCreateWorktreeTrigger(repoId)
  const label = t('action.create-worktree-title')
  const shortcutLabel = formatAccelerator(CREATE_WORKTREE_SHORTCUT)

  return (
    <SidebarRowButton
      onClick={() => {
        if (!disabled) openCreateWorktree()
      }}
      disabled={disabled}
      aria-label={`${label} (${shortcutLabel})`}
      data-testid="create-worktree-button"
      size="dense"
      className="group"
      leading={<FolderPlus size={16} />}
      trailing={<InlineShortcut shortcut={shortcutLabel} showOnHover={true} aria-hidden={true} />}
    >
      {label}
    </SidebarRowButton>
  )
}

function useCreateWorktreeTrigger(repoId: string) {
  const overlayActions = useContext(LayoutOverlayActions)
  const branchAction = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return repo ? repo.operations.branchAction : null
    },
    (a, b) => a === b || (!!a && !!b && a.phase === b.phase && a.reason === b.reason && a.target === b.target),
  )
  const branchActionBusy = branchAction ? branchAction.phase !== 'idle' : true
  return {
    disabled: branchActionBusy,
    openCreateWorktree: () => overlayActions?.openCreateWorktree(),
  }
}
