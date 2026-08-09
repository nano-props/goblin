import { computed, defineComponent } from 'vue'
import type { FunctionalComponent } from 'vue'
import { GitBranchPlus } from '@lucide/vue'
import { formatAccelerator } from '#/shared/accelerator.ts'
import type { BranchViewMode } from '#/shared/api-types.ts'
import { CREATE_WORKTREE_SHORTCUT } from '#/shared/shortcut-definitions.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { InlineShortcut } from '#/web/components/InlineShortcut.tsx'
import { RepoActivityControl } from '#/web/components/repo-activity/RepoActivityControl.tsx'
import { BranchViewModeControl } from '#/web/components/repo-toolbar/BranchViewModeControl.tsx'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { projectBranchActionOperation } from '#/web/hooks/branch-action-state.ts'
import { useLayoutOverlayActions } from '#/web/layout-overlay-actions-context.ts'
import { useRepoOperationsReadModel, useRepoSnapshotReadModel } from '#/web/repo-queries.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { branchViewModeForWorkspace, DEFAULT_BRANCH_VIEW_MODE } from '#/web/stores/workspaces/branch-view-mode.ts'
import type { RepoOperationState } from '#/web/stores/workspaces/operations.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

interface Props {
  repoId: WorkspaceId
}

interface CreateWorktreeRowActionProps extends Props {
  selected?: boolean
  onCreateWorktree?: () => void
}

export const RepoSyncAction: FunctionalComponent<Props> = (props) => <RepoActivityControl repoId={props.repoId} />
RepoSyncAction.props = ['repoId']

export const BranchFilterAction: FunctionalComponent<Props> = (props) => <WorktreeFilterToggle repoId={props.repoId} />
BranchFilterAction.props = ['repoId']

const WorktreeFilterToggle = defineComponent<Props>({
  name: 'WorktreeFilterToggle',
  props: ['repoId'],
  setup(props) {
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const branchViewModeByWorkspace = useStoreSelector(workspacesStore, (state) => state.branchViewModeByWorkspace)
    const repoView = computed<WorktreeFilterRepo | null>(() => {
      const repo = workspaces.value[props.repoId]
      return repo?.capability.kind === 'git'
        ? {
            id: repo.id,
            workspaceRuntimeId: repo.workspaceRuntimeId,
            branchViewMode: branchViewModeForWorkspace(branchViewModeByWorkspace.value, repo.id),
          }
        : null
    })
    return () =>
      repoView.value ? (
        <WorktreeFilterReadModel repo={repoView.value} />
      ) : (
        <BranchViewModeControl value={DEFAULT_BRANCH_VIEW_MODE} disabled onChange={() => {}} />
      )
  },
})

interface WorktreeFilterRepo {
  id: WorkspaceId
  workspaceRuntimeId: string
  branchViewMode: BranchViewMode
}

const WorktreeFilterReadModel = defineComponent<{ repo: WorktreeFilterRepo }>({
  name: 'WorktreeFilterReadModel',
  inheritAttrs: false,
  props: ['repo'],
  setup(props) {
    const snapshotReadModel = useRepoSnapshotReadModel(
      () => props.repo.id,
      () => props.repo.workspaceRuntimeId,
    )

    function setBranchViewMode(viewMode: BranchViewMode): void {
      workspacesStore.getState().setBranchViewMode(props.repo.id, viewMode)
    }

    return () => (
      <BranchViewModeControl
        value={props.repo.branchViewMode}
        disabled={!snapshotReadModel.data.value || snapshotReadModel.data.value.snapshot.branches.length === 0}
        onChange={setBranchViewMode}
      />
    )
  },
})

export const CreateWorktreeRowAction = defineComponent<CreateWorktreeRowActionProps>({
  name: 'CreateWorktreeRowAction',
  props: ['repoId', 'selected', 'onCreateWorktree'],
  setup(props) {
    const overlayActions = useLayoutOverlayActions()
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const repo = computed<CreateWorktreeActionRepo | null>(() => {
      const workspace = workspaces.value[props.repoId]
      return workspace?.capability.kind === 'git'
        ? {
            id: workspace.id,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            branchAction: workspace.capability.git.operations.branchAction,
          }
        : null
    })

    function openCreateWorktree(): void {
      if (props.onCreateWorktree) props.onCreateWorktree()
      else overlayActions?.openCreateWorktree()
    }

    return () =>
      repo.value ? (
        <CreateWorktreeRowActionReadModel
          repo={repo.value}
          selected={props.selected ?? false}
          onActivate={openCreateWorktree}
        />
      ) : (
        <CreateWorktreeRowActionView disabled selected={props.selected ?? false} onActivate={openCreateWorktree} />
      )
  },
})

interface CreateWorktreeActionRepo {
  id: WorkspaceId
  workspaceRuntimeId: string
  branchAction: RepoOperationState
}

interface CreateWorktreeRowActionViewProps {
  disabled: boolean
  selected: boolean
  onActivate: () => void
}

const CreateWorktreeRowActionReadModel = defineComponent<{
  repo: CreateWorktreeActionRepo
  selected: boolean
  onActivate: () => void
}>({
  name: 'CreateWorktreeRowActionReadModel',
  inheritAttrs: false,
  props: ['repo', 'selected', 'onActivate'],
  setup(props) {
    const operationsReadModel = useRepoOperationsReadModel(
      () => props.repo.id,
      () => props.repo.workspaceRuntimeId,
    )
    const branchAction = computed(() => {
      return projectBranchActionOperation(props.repo.branchAction, operationsReadModel.data.value?.operations)
    })
    return () => (
      <CreateWorktreeRowActionView
        disabled={branchAction.value.phase !== 'idle'}
        selected={props.selected}
        onActivate={props.onActivate}
      />
    )
  },
})

const CreateWorktreeRowActionView = defineComponent<CreateWorktreeRowActionViewProps>({
  name: 'CreateWorktreeRowActionView',
  inheritAttrs: false,
  props: ['disabled', 'selected', 'onActivate'],
  setup(props) {
    const t = useT()
    const shortcutLabel = formatAccelerator(CREATE_WORKTREE_SHORTCUT)
    return () => {
      const label = t('action.create-worktree-title')
      return (
        <SidebarRowButton
          onClick={props.onActivate}
          disabled={props.disabled}
          selected={props.selected}
          aria-label={`${label} (${shortcutLabel})`}
          data-testid="create-worktree-button"
          size="dense"
          class="group"
          leading={<GitBranchPlus size={16} />}
          trailing={<InlineShortcut shortcut={shortcutLabel} showOnHover={true} ariaHidden={true} />}
        >
          {label}
        </SidebarRowButton>
      )
    }
  },
})
