// Layout-level host for the five branch action confirmation dialogs
// (push / delete branch / force-delete / remove worktree / force-
// remove worktree).
//
// Mounted once in `Layout.PrimaryWindowOverlays`, outside `<Outlet />`, so
// it survives settings ⇄ workspace navigation. State lives in
// `useBranchActionDialogsStore`, not in any React component local
// state, so a confirmation requested from a temporary surface (e.g.
// the zen-mode HoverCard popover) survives the surface unmounting.
//
// Every confirmation is resolved against the **dialog payload's**
// `(repoId, branchName)`, looked up in `useWorkspacesStore` via
// `useBranchActionDialogDisplay`. The user can open a confirmation
// for a non-selected branch row (e.g. a row in the zen-mode
// HoverCard popover) and confirm against the right branch data, not
// the workspace's current route branch. When the user switches current
// repo or current branch, the `closeStaleDialogs` effect below
// closes any open dialog whose `(repoId, branchName)` no longer
// matches — no stale "Delete worktree for branch X" dialog can be
// confirmed against repo B's cwd.
//
// Data flow per slot: the host subscribes to the raw slot (drives
// Radix's `open` prop) and calls `useBranchActionDialogDisplay(slot,
// repos)` for the body-visible data (title, message, checkbox
// state). The display hook retains its entry across close so the
// inner content stays rendered for the duration of the Radix close
// animation. See `web/hooks/useBranchActionDialogDisplay.ts` for the
// retention contract.
//
// Body content (the visual presentation below the title) lives in
// `./branch-action-dialogs/bodies.tsx`. The bodies receive the
// already-narrowed display values as plain props, so they never
// touch global state and never need non-null assertions.

import { Trans } from 'react-i18next'
import { useEffect } from 'react'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import {
  DeleteBranchConfirmBody,
  ForceRemoveWorktreeConfirmBody,
  RemoveWorktreeConfirmBody,
} from '#/web/components/branch-action-dialogs/bodies.tsx'
import { formatWorktreePath } from '#/web/lib/paths.ts'
import { remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import { useT } from '#/web/stores/i18n.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import { useBranchActionDialogsStore } from '#/web/stores/workspaces/branch-action-dialogs.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { dispatchDeleteBranch, dispatchPush, dispatchRemoveWorktree } from '#/web/hooks/branchActionDispatch.ts'
import { useBranchActionDialogDisplay } from '#/web/hooks/useBranchActionDialogDisplay.ts'
import type { RepoBranchState } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface Props {
  /**
   * The current route `(repoId, branchName)`. Used as the key for
   * `closeStaleDialogs`. Pass `null` when no repo is current — the
   * host closes any stale dialog before rendering.
   */
  currentWorkspaceId: WorkspaceId | null
  currentBranchName: string | null
}

function hasUpstream(branch: RepoBranchState): boolean {
  return !!branch.tracking && !branch.trackingGone
}

export function BranchActionDialogHost({ currentWorkspaceId, currentBranchName }: Props) {
  const t = useT()

  // One subscription per slot — re-renders are scoped to the dialog
  // that actually changed. The host still re-renders as a whole when
  // any slot changes, but Radix renders nothing visible for
  // `open={false}` dialogs, so the per-dialog cost is small.
  const pushConfirm = useBranchActionDialogsStore((s) => s.pushConfirm)
  const deleteConfirm = useBranchActionDialogsStore((s) => s.deleteConfirm)
  const forceDeleteConfirm = useBranchActionDialogsStore((s) => s.forceDeleteConfirm)
  const removeConfirm = useBranchActionDialogsStore((s) => s.removeConfirm)
  const forceRemoveConfirm = useBranchActionDialogsStore((s) => s.forceRemoveConfirm)

  // Store actions. Functions are stable references defined once at
  // store creation.
  const closeDialog = useBranchActionDialogsStore((s) => s.closeDialog)
  const closeStaleDialogs = useBranchActionDialogsStore((s) => s.closeStaleDialogs)
  const setRemoveAlsoDeletes = useBranchActionDialogsStore((s) => s.setRemoveAlsoDeletes)
  const setRemoveAlsoUpstream = useBranchActionDialogsStore((s) => s.setRemoveAlsoUpstream)
  const setDeleteAlsoUpstream = useBranchActionDialogsStore((s) => s.setDeleteAlsoUpstream)

  // Single subscription to `repos` shared by all five
  // `useBranchActionDialogDisplay` calls below — see the hook's
  // header for why.
  const repos = useWorkspacesStore((s) => s.workspaces)

  // Per-slot display view. Each view bundles:
  //   - `entry`: the retained slot entry. Drives title / message /
  //     checkbox identity.
  //   - `liveContext`: the `(repo, branch)` resolved against the
  //     *live* slot. Drives the `open` prop on `<AlertDialog>`.
  //   - `displayContext`: the `(repo, branch)` resolved against the
  //     *retained* entry. Drives `hasUpstream` / `tracking`.
  //   - `displayCheckboxes`: persisted checkbox state retained
  //     across close.
  const pushConfirmView = useBranchActionDialogDisplay(pushConfirm, repos)
  const deleteConfirmView = useBranchActionDialogDisplay(deleteConfirm, repos)
  const forceDeleteConfirmView = useBranchActionDialogDisplay(forceDeleteConfirm, repos)
  const removeConfirmView = useBranchActionDialogDisplay(removeConfirm, repos)
  const forceRemoveConfirmView = useBranchActionDialogDisplay(forceRemoveConfirm, repos)

  // Protected-branch read for the remove-worktree body. Derived from
  // the *retained* display entry so the checkbox-disabled state and
  // the hint block stay stable across the close animation.
  const removeConfirmProtected = removeConfirmView.entry
    ? PROTECTED_BRANCHES.has(removeConfirmView.entry.payload.branch)
    : false

  // Auto-close any dialog whose (repoId, branchName) no longer
  // matches the current workspace route. The effect's deps include the
  // `closeStaleDialogs` action reference for exhaustive-deps; the
  // action function is a stable zustand reference, so the effect
  // still fires exactly when `currentWorkspaceId` or `currentBranchName`
  // changes — not when the user opens or closes a dialog.
  useEffect(() => {
    closeStaleDialogs(currentWorkspaceId, currentBranchName)
  }, [currentWorkspaceId, currentBranchName, closeStaleDialogs])

  return (
    <>
      <ConfirmDialog
        open={pushConfirm !== null && pushConfirmView.liveContext !== null}
        title={
          pushConfirmView.entry
            ? t('action.confirm-push-protected-title', { branch: pushConfirmView.entry.payload })
            : ''
        }
        message={
          pushConfirmView.entry ? (
            <Trans
              i18nKey="action.confirm-push-protected-body"
              values={{ branch: pushConfirmView.entry.payload }}
              components={{ branch: <b className="text-foreground" /> }}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-push-confirm')}
        destructive
        onCancel={() => closeDialog('pushConfirm')}
        onConfirm={() => {
          const { entry, liveContext } = pushConfirmView
          closeDialog('pushConfirm')
          if (entry && liveContext) {
            // Return the IPC promise so `useAsyncPending.run` keeps the
            // Confirm button `aria-busy` and rejects duplicate clicks
            // for the duration of the round-trip.
            return dispatchPush({ repo: liveContext.repo, branchName: entry.payload })
          }
          return undefined
        }}
      />

      <ConfirmDialog
        open={deleteConfirm !== null && deleteConfirmView.liveContext !== null}
        title={t('action.confirm-delete-branch-title')}
        message={
          deleteConfirmView.entry && deleteConfirmView.displayContext ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-delete-branch-body')}
              branchName={deleteConfirmView.entry.payload}
              note={t('action.confirm-delete-branch-note')}
              hasUpstream={hasUpstream(deleteConfirmView.displayContext.branch)}
              deleteAlsoUpstream={deleteConfirmView.displayCheckboxes.deleteAlsoUpstream}
              tracking={deleteConfirmView.displayContext.branch.tracking}
              onDeleteAlsoUpstreamChange={(value) =>
                setDeleteAlsoUpstream(deleteConfirmView.entry!.repoId, deleteConfirmView.entry!.branchName, value)
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
          const liveContext = deleteConfirmView.liveContext
          closeDialog('deleteConfirm')
          if (liveContext) {
            return dispatchDeleteBranch({
              repo: liveContext.repo,
              branchName: deleteConfirmView.entry!.payload,
              force: false,
              deleteUpstream: deleteConfirmView.displayCheckboxes.deleteAlsoUpstream,
            })
          }
          return undefined
        }}
      />

      <ConfirmDialog
        open={forceDeleteConfirm !== null && forceDeleteConfirmView.liveContext !== null}
        title={t('action.confirm-force-delete-unmerged-title')}
        message={
          forceDeleteConfirmView.entry && forceDeleteConfirmView.displayContext ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-force-delete-unmerged-body')}
              branchName={forceDeleteConfirmView.entry.payload}
              note={t('action.confirm-force-delete-unmerged-note')}
              hasUpstream={hasUpstream(forceDeleteConfirmView.displayContext.branch)}
              deleteAlsoUpstream={forceDeleteConfirmView.displayCheckboxes.deleteAlsoUpstream}
              tracking={forceDeleteConfirmView.displayContext.branch.tracking}
              onDeleteAlsoUpstreamChange={(value) =>
                setDeleteAlsoUpstream(
                  forceDeleteConfirmView.entry!.repoId,
                  forceDeleteConfirmView.entry!.branchName,
                  value,
                )
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
          const liveContext = forceDeleteConfirmView.liveContext
          closeDialog('forceDeleteConfirm')
          if (liveContext) {
            return dispatchDeleteBranch({
              repo: liveContext.repo,
              branchName: forceDeleteConfirmView.entry!.payload,
              force: true,
              deleteUpstream: forceDeleteConfirmView.displayCheckboxes.deleteAlsoUpstream,
            })
          }
          return undefined
        }}
      />

      <ConfirmDialog
        open={removeConfirm !== null && removeConfirmView.liveContext !== null}
        title={t('action.confirm-remove-worktree-title')}
        message={
          removeConfirmView.entry && removeConfirmView.displayContext ? (
            <RemoveWorktreeConfirmBody
              body={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(
                removeConfirmView.entry.payload.path,
                remoteWorkspaceTarget(
                  removeConfirmView.displayContext.repo.id,
                  removeConfirmView.displayContext.repo.remoteLifecycle,
                ),
              )}
              branchName={removeConfirmView.entry.payload.branch}
              protectedHint={t('action.confirm-remove-worktree-protected-hint')}
              removeAlsoDeletes={removeConfirmView.displayCheckboxes.removeAlsoDeletes}
              removeConfirmProtected={removeConfirmProtected}
              hasUpstream={hasUpstream(removeConfirmView.displayContext.branch)}
              tracking={removeConfirmView.displayContext.branch.tracking}
              removeAlsoUpstream={removeConfirmView.displayCheckboxes.removeAlsoUpstream}
              onRemoveAlsoDeletesChange={(value) =>
                setRemoveAlsoDeletes(removeConfirmView.entry!.repoId, removeConfirmView.entry!.branchName, value)
              }
              onRemoveAlsoUpstreamChange={(value) =>
                setRemoveAlsoUpstream(removeConfirmView.entry!.repoId, removeConfirmView.entry!.branchName, value)
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
          const liveContext = removeConfirmView.liveContext
          if (!liveContext) {
            closeDialog('removeConfirm')
            return undefined
          }
          closeDialog('removeConfirm')
          return dispatchRemoveWorktree({
            repo: liveContext.repo,
            target: removeConfirmView.entry!.payload,
            deleteBranch: removeConfirmView.displayCheckboxes.removeAlsoDeletes,
            forceDeleteBranch: false,
            deleteUpstream: removeConfirmView.displayCheckboxes.removeAlsoUpstream,
          })
        }}
      />

      <ConfirmDialog
        open={forceRemoveConfirm !== null && forceRemoveConfirmView.liveContext !== null}
        title={t('action.confirm-force-delete-branch-title')}
        message={
          forceRemoveConfirmView.entry && forceRemoveConfirmView.displayContext ? (
            <ForceRemoveWorktreeConfirmBody
              removeBody={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(
                forceRemoveConfirmView.entry.payload.path,
                remoteWorkspaceTarget(
                  forceRemoveConfirmView.displayContext.repo.id,
                  forceRemoveConfirmView.displayContext.repo.remoteLifecycle,
                ),
              )}
              forceDeleteBody={t('action.confirm-force-delete-branch-body')}
              branchName={forceRemoveConfirmView.entry.payload.branch}
              note={t('action.confirm-force-delete-branch-note')}
              hasUpstream={hasUpstream(forceRemoveConfirmView.displayContext.branch)}
              tracking={forceRemoveConfirmView.displayContext.branch.tracking}
              removeAlsoUpstream={forceRemoveConfirmView.displayCheckboxes.removeAlsoUpstream}
              onRemoveAlsoUpstreamChange={(value) =>
                setRemoveAlsoUpstream(
                  forceRemoveConfirmView.entry!.repoId,
                  forceRemoveConfirmView.entry!.branchName,
                  value,
                )
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
          const liveContext = forceRemoveConfirmView.liveContext
          if (!liveContext) {
            closeDialog('forceRemoveConfirm')
            return undefined
          }
          closeDialog('forceRemoveConfirm')
          return dispatchRemoveWorktree({
            repo: liveContext.repo,
            target: forceRemoveConfirmView.entry!.payload,
            deleteBranch: true,
            forceDeleteBranch: true,
            deleteUpstream: forceRemoveConfirmView.displayCheckboxes.removeAlsoUpstream,
          })
        }}
      />
    </>
  )
}
