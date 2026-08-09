import { I18nT } from 'vue-i18n'
import { computed, defineComponent, watch } from 'vue'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import {
  DeleteBranchConfirmBody,
  ForceRemoveWorktreeConfirmBody,
  RemoveWorktreeConfirmBody,
} from '#/web/components/branch-action-dialogs/bodies.tsx'
import { dispatchDeleteBranch, dispatchPush, dispatchRemoveWorktree } from '#/web/hooks/branchActionDispatch.ts'
import { useBranchActionDialogDisplay } from '#/web/hooks/useBranchActionDialogDisplay.ts'
import type { BranchActionDialogRepoShell, BranchActionDialogTarget } from '#/web/hooks/useBranchActionDialogDisplay.ts'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'
import { formatWorktreePath } from '#/web/lib/paths.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { branchActionDialogsStore } from '#/web/stores/workspaces/branch-action-dialogs.ts'
import type {
  BranchActionDialogEntry,
  RemoveWorktreeDialogPayload,
} from '#/web/stores/workspaces/branch-action-dialogs.ts'
import { remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

interface Props {
  currentWorkspaceId: WorkspaceId | null
  currentBranchName: string | null
}

type ActiveBranchActionDialog =
  | { kind: 'pushConfirm'; entry: BranchActionDialogEntry<string> }
  | { kind: 'deleteConfirm'; entry: BranchActionDialogEntry<string> }
  | { kind: 'forceDeleteConfirm'; entry: BranchActionDialogEntry<string> }
  | { kind: 'removeConfirm'; entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload> }
  | { kind: 'forceRemoveConfirm'; entry: BranchActionDialogEntry<RemoveWorktreeDialogPayload> }

type BranchActionDialogOwnerTarget = ActiveBranchActionDialog & { repo: BranchActionDialogRepoShell }

// Matches the `duration-200` AlertDialog exit animation. The query owner stays
// mounted only for this bounded presentation lifetime after the slot closes.
const BRANCH_ACTION_DIALOG_EXIT_MS = 200

function hasUpstream(branch: BranchSnapshotInfo): boolean {
  return !!branch.tracking && !branch.trackingGone
}

function activeBranchActionDialog(
  state: ReturnType<typeof branchActionDialogsStore.getState>,
): ActiveBranchActionDialog | null {
  if (state.pushConfirm) return { kind: 'pushConfirm', entry: state.pushConfirm }
  if (state.deleteConfirm) return { kind: 'deleteConfirm', entry: state.deleteConfirm }
  if (state.forceDeleteConfirm) return { kind: 'forceDeleteConfirm', entry: state.forceDeleteConfirm }
  if (state.removeConfirm) return { kind: 'removeConfirm', entry: state.removeConfirm }
  if (state.forceRemoveConfirm) return { kind: 'forceRemoveConfirm', entry: state.forceRemoveConfirm }
  return null
}

export const BranchActionDialogHost = defineComponent<Props>({
  name: 'BranchActionDialogHost',
  inheritAttrs: false,
  props: ['currentWorkspaceId', 'currentBranchName'],
  setup(props) {
    const dialogs = useStoreSelector(branchActionDialogsStore, (state) => state)
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const activeDialog = computed(() => activeBranchActionDialog(dialogs.value))
    const liveTarget = computed<BranchActionDialogOwnerTarget | null>(() => {
      const dialog = activeDialog.value
      if (!dialog) return null
      const workspace = workspaces.value[dialog.entry.repoId]
      if (workspace?.capability.kind !== 'git') return null
      return {
        ...dialog,
        repo: {
          id: workspace.id,
          workspaceRuntimeId: workspace.workspaceRuntimeId,
          branchAction: workspace.capability.git.operations.branchAction,
          remoteLifecycle: workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
        },
      }
    })
    const retainedTarget = useRetainedValueDuringExit({
      value: liveTarget,
      active: () => liveTarget.value !== null,
      retainMs: BRANCH_ACTION_DIALOG_EXIT_MS,
    })
    const { closeStaleDialogs } = branchActionDialogsStore.getState()

    // A confirmation is authoritative only for the route identity that opened it.
    watch(
      [() => props.currentWorkspaceId, () => props.currentBranchName],
      ([workspaceId, branchName]) => closeStaleDialogs(workspaceId, branchName),
      { immediate: true },
    )

    return () => {
      const target = retainedTarget.value
      return target ? (
        <BranchActionDialogReadModelOwner
          key={`${target.kind}\u0000${target.entry.repoId}\u0000${target.entry.branchName}`}
          target={target}
          open={liveTarget.value !== null}
        />
      ) : null
    }
  },
})

interface BranchActionDialogReadModelOwnerProps {
  target: BranchActionDialogOwnerTarget
  open: boolean
}

const BranchActionDialogReadModelOwner = defineComponent<BranchActionDialogReadModelOwnerProps>({
  name: 'BranchActionDialogReadModelOwner',
  inheritAttrs: false,
  props: ['target', 'open'],
  setup(props) {
    const t = useT()
    const display = useBranchActionDialogDisplay(
      () => dialogReadTarget(props.target),
      () => props.open,
    )
    const { closeDialog, setRemoveAlsoDeletes, setRemoveAlsoUpstream, setDeleteAlsoUpstream } =
      branchActionDialogsStore.getState()

    return () => {
      const { target } = props
      const context = display.displayContext
      const open = props.open && display.liveContext !== null

      switch (target.kind) {
        case 'pushConfirm':
          return (
            <ConfirmDialog
              open={open}
              title={t('action.confirm-push-protected-title', { branch: target.entry.payload })}
              message={
                <I18nT
                  keypath="action.confirm-push-protected-body"
                  tag="span"
                  scope="global"
                  v-slots={{
                    branch: () => <b class="text-foreground">{target.entry.payload}</b>,
                  }}
                />
              }
              confirmLabel={t('action.confirm-push-confirm')}
              destructive
              onCancel={() => closeDialog('pushConfirm')}
              onConfirm={() => {
                const liveContext = display.liveContext
                closeDialog('pushConfirm')
                return liveContext
                  ? dispatchPush({ repo: liveContext.repo, branchName: target.entry.payload })
                  : undefined
              }}
            />
          )

        case 'deleteConfirm':
          return (
            <ConfirmDialog
              open={open}
              title={t('action.confirm-delete-branch-title')}
              message={
                context ? (
                  <DeleteBranchConfirmBody
                    body={t('action.confirm-delete-branch-body')}
                    branchName={target.entry.payload}
                    note={t('action.confirm-delete-branch-note')}
                    hasUpstream={hasUpstream(context.branch)}
                    deleteAlsoUpstream={display.displayCheckboxes.deleteAlsoUpstream}
                    tracking={context.branch.tracking}
                    onDeleteAlsoUpstreamChange={(value) =>
                      setDeleteAlsoUpstream(target.entry.repoId, target.entry.branchName, value)
                    }
                    upstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
                  />
                ) : (
                  ''
                )
              }
              confirmLabel={t('action.confirm-delete-branch-confirm')}
              destructive
              onCancel={() => closeDialog('deleteConfirm')}
              onConfirm={() => {
                const liveContext = display.liveContext
                closeDialog('deleteConfirm')
                return liveContext
                  ? dispatchDeleteBranch({
                      repo: liveContext.repo,
                      branchName: target.entry.payload,
                      force: false,
                      deleteUpstream: display.displayCheckboxes.deleteAlsoUpstream,
                    })
                  : undefined
              }}
            />
          )

        case 'forceDeleteConfirm':
          return (
            <ConfirmDialog
              open={open}
              title={t('action.confirm-force-delete-unmerged-title')}
              message={
                context ? (
                  <DeleteBranchConfirmBody
                    body={t('action.confirm-force-delete-unmerged-body')}
                    branchName={target.entry.payload}
                    note={t('action.confirm-force-delete-unmerged-note')}
                    hasUpstream={hasUpstream(context.branch)}
                    deleteAlsoUpstream={display.displayCheckboxes.deleteAlsoUpstream}
                    tracking={context.branch.tracking}
                    onDeleteAlsoUpstreamChange={(value) =>
                      setDeleteAlsoUpstream(target.entry.repoId, target.entry.branchName, value)
                    }
                    upstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
                  />
                ) : (
                  ''
                )
              }
              confirmLabel={t('action.confirm-force-delete-unmerged-confirm')}
              destructive
              onCancel={() => closeDialog('forceDeleteConfirm')}
              onConfirm={() => {
                const liveContext = display.liveContext
                closeDialog('forceDeleteConfirm')
                return liveContext
                  ? dispatchDeleteBranch({
                      repo: liveContext.repo,
                      branchName: target.entry.payload,
                      force: true,
                      deleteUpstream: display.displayCheckboxes.deleteAlsoUpstream,
                    })
                  : undefined
              }}
            />
          )

        case 'removeConfirm': {
          const protectedBranch = PROTECTED_BRANCHES.has(target.entry.payload.branch)
          return (
            <ConfirmDialog
              open={open}
              title={t('action.confirm-remove-worktree-title')}
              message={
                context ? (
                  <RemoveWorktreeConfirmBody
                    body={t('action.confirm-remove-worktree-body')}
                    path={formatWorktreePath(
                      target.entry.payload.path,
                      remoteWorkspaceTarget(context.repo.id, context.repo.remoteLifecycle),
                    )}
                    branchName={target.entry.payload.branch}
                    protectedHint={t('action.confirm-remove-worktree-protected-hint')}
                    removeAlsoDeletes={display.displayCheckboxes.removeAlsoDeletes}
                    removeConfirmProtected={protectedBranch}
                    hasUpstream={hasUpstream(context.branch)}
                    tracking={context.branch.tracking}
                    removeAlsoUpstream={display.displayCheckboxes.removeAlsoUpstream}
                    onRemoveAlsoDeletesChange={(value) =>
                      setRemoveAlsoDeletes(target.entry.repoId, target.entry.branchName, value)
                    }
                    onRemoveAlsoUpstreamChange={(value) =>
                      setRemoveAlsoUpstream(target.entry.repoId, target.entry.branchName, value)
                    }
                    deleteBranchLabel={t('action.confirm-remove-worktree-also-delete-branch')}
                    deleteUpstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
                  />
                ) : (
                  ''
                )
              }
              confirmLabel={t('action.confirm-remove-worktree-confirm')}
              destructive
              onCancel={() => closeDialog('removeConfirm')}
              onConfirm={() => {
                const liveContext = display.liveContext
                closeDialog('removeConfirm')
                return liveContext
                  ? dispatchRemoveWorktree({
                      repo: liveContext.repo,
                      target: target.entry.payload,
                      deleteBranch: display.displayCheckboxes.removeAlsoDeletes,
                      forceDeleteBranch: false,
                      deleteUpstream: display.displayCheckboxes.removeAlsoUpstream,
                    })
                  : undefined
              }}
            />
          )
        }

        case 'forceRemoveConfirm':
          return (
            <ConfirmDialog
              open={open}
              title={t('action.confirm-force-delete-branch-title')}
              message={
                context ? (
                  <ForceRemoveWorktreeConfirmBody
                    removeBody={t('action.confirm-remove-worktree-body')}
                    path={formatWorktreePath(
                      target.entry.payload.path,
                      remoteWorkspaceTarget(context.repo.id, context.repo.remoteLifecycle),
                    )}
                    forceDeleteBody={t('action.confirm-force-delete-branch-body')}
                    branchName={target.entry.payload.branch}
                    note={t('action.confirm-force-delete-branch-note')}
                    hasUpstream={hasUpstream(context.branch)}
                    tracking={context.branch.tracking}
                    removeAlsoUpstream={display.displayCheckboxes.removeAlsoUpstream}
                    onRemoveAlsoUpstreamChange={(value) =>
                      setRemoveAlsoUpstream(target.entry.repoId, target.entry.branchName, value)
                    }
                    deleteUpstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
                  />
                ) : (
                  ''
                )
              }
              confirmLabel={t('action.confirm-force-delete-branch-confirm')}
              destructive
              onCancel={() => closeDialog('forceRemoveConfirm')}
              onConfirm={() => {
                const liveContext = display.liveContext
                closeDialog('forceRemoveConfirm')
                return liveContext
                  ? dispatchRemoveWorktree({
                      repo: liveContext.repo,
                      target: target.entry.payload,
                      deleteBranch: true,
                      forceDeleteBranch: true,
                      deleteUpstream: display.displayCheckboxes.removeAlsoUpstream,
                    })
                  : undefined
              }}
            />
          )
      }
    }
  },
})

function dialogReadTarget(target: BranchActionDialogOwnerTarget): BranchActionDialogTarget<unknown> {
  return { entry: target.entry, repo: target.repo }
}
