// Layout-level host for the five branch action confirmation dialogs
// (push / delete branch / force-delete / remove worktree / force-
// remove worktree).
//
// Mounted once in `Layout.MainWindowOverlays`, outside `<Outlet />`, so
// it survives settings ⇄ workspace navigation. State lives in
// `useBranchActionDialogsStore`, not in any React component local
// state, so a confirmation requested from a temporary surface (e.g.
// the focus-mode HoverCard popover) survives the surface unmounting.
//
// Every confirmation is resolved against the **dialog payload's**
// `(repoId, branchName)`, looked up in `useReposStore` via
// `useBranchActionDialogDisplay`. The user can open a confirmation
// for a non-selected branch row (e.g. a row in the focus-mode
// HoverCard popover) and confirm against the right branch data, not
// the workspace's selected branch. When the user switches active
// repo or selected branch, the `closeStaleDialogs` effect below
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
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import { useT } from '#/web/stores/i18n.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import { useBranchActionDialogsStore } from '#/web/stores/repos/branch-action-dialogs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  dispatchDeleteBranch,
  dispatchPush,
  dispatchRemoveWorktree,
} from '#/web/hooks/branchActionDispatch.ts'
import { useBranchActionDialogDisplay } from '#/web/hooks/useBranchActionDialogDisplay.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

interface Props {
  /**
   * The currently active `(repoId, branchName)`. Used as the key for
   * `closeStaleDialogs`. Pass `null` when no repo is active — the
   * host closes any stale dialog before rendering.
   */
  activeRepoId: string | null
  activeBranchName: string | null
}

function hasUpstream(branch: RepoBranchState): boolean {
  return !!branch.tracking && !branch.trackingGone
}

export function BranchActionDialogHost({ activeRepoId, activeBranchName }: Props) {
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
  const repos = useReposStore((s) => s.repos)

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
  // matches the active workspace. The effect's deps include the
  // `closeStaleDialogs` action reference for exhaustive-deps; the
  // action function is a stable zustand reference, so the effect
  // still fires exactly when `activeRepoId` or `activeBranchName`
  // changes — not when the user opens or closes a dialog.
  useEffect(() => {
    closeStaleDialogs(activeRepoId ?? '', activeBranchName ?? '')
  }, [activeRepoId, activeBranchName, closeStaleDialogs])

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
            dispatchPush({ repo: liveContext.repo, branchName: entry.payload })
          }
        }}
      />

      {(() => {
        const { entry, displayContext, displayCheckboxes } = deleteConfirmView
        if (!entry || !displayContext) {
          return (
            <ConfirmDialog
              open={deleteConfirm !== null && deleteConfirmView.liveContext !== null}
              title=""
              message=""
              confirmLabel={t('action.confirm-delete-branch-confirm')}
              destructive
              onCancel={() => closeDialog('deleteConfirm')}
              onConfirm={() => closeDialog('deleteConfirm')}
            />
          )
        }
        return (
          <ConfirmDialog
            open={deleteConfirm !== null && deleteConfirmView.liveContext !== null}
            title={t('action.confirm-delete-branch-title')}
            message={
              <DeleteBranchConfirmBody
                body={t('action.confirm-delete-branch-body')}
                branchName={entry.payload}
                note={t('action.confirm-delete-branch-note')}
                hasUpstream={hasUpstream(displayContext.branch)}
                deleteAlsoUpstream={displayCheckboxes.deleteAlsoUpstream}
                tracking={displayContext.branch.tracking}
                onDeleteAlsoUpstreamChange={(value) =>
                  setDeleteAlsoUpstream(entry.repoId, entry.branchName, value)
                }
                upstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
              />
            }
            confirmLabel={t('action.confirm-delete-branch-confirm')}
            destructive
            onCancel={() => closeDialog('deleteConfirm')}
            onConfirm={() => {
              const liveContext = deleteConfirmView.liveContext
              closeDialog('deleteConfirm')
              if (liveContext) {
                dispatchDeleteBranch({
                  repo: liveContext.repo,
                  branchName: entry.payload,
                  force: false,
                  alsoDeleteUpstream: displayCheckboxes.deleteAlsoUpstream,
                })
              }
            }}
          />
        )
      })()}

      {(() => {
        const { entry, displayContext, displayCheckboxes } = forceDeleteConfirmView
        if (!entry || !displayContext) {
          return (
            <ConfirmDialog
              open={forceDeleteConfirm !== null && forceDeleteConfirmView.liveContext !== null}
              title=""
              message=""
              confirmLabel={t('action.confirm-force-delete-unmerged-confirm')}
              destructive
              onCancel={() => closeDialog('forceDeleteConfirm')}
              onConfirm={() => closeDialog('forceDeleteConfirm')}
            />
          )
        }
        return (
          <ConfirmDialog
            open={forceDeleteConfirm !== null && forceDeleteConfirmView.liveContext !== null}
            title={t('action.confirm-force-delete-unmerged-title')}
            message={
              <DeleteBranchConfirmBody
                body={t('action.confirm-force-delete-unmerged-body')}
                branchName={entry.payload}
                note={t('action.confirm-force-delete-unmerged-note')}
                hasUpstream={hasUpstream(displayContext.branch)}
                deleteAlsoUpstream={displayCheckboxes.deleteAlsoUpstream}
                tracking={displayContext.branch.tracking}
                onDeleteAlsoUpstreamChange={(value) =>
                  setDeleteAlsoUpstream(entry.repoId, entry.branchName, value)
                }
                upstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
              />
            }
            confirmLabel={t('action.confirm-force-delete-unmerged-confirm')}
            destructive
            onCancel={() => closeDialog('forceDeleteConfirm')}
            onConfirm={() => {
              const liveContext = forceDeleteConfirmView.liveContext
              closeDialog('forceDeleteConfirm')
              if (liveContext) {
                dispatchDeleteBranch({
                  repo: liveContext.repo,
                  branchName: entry.payload,
                  force: true,
                  alsoDeleteUpstream: displayCheckboxes.deleteAlsoUpstream,
                })
              }
            }}
          />
        )
      })()}

      {(() => {
        const { entry, displayContext, displayCheckboxes } = removeConfirmView
        if (!entry || !displayContext) {
          return (
            <ConfirmDialog
              open={removeConfirm !== null && removeConfirmView.liveContext !== null}
              title=""
              message=""
              confirmLabel={t('action.confirm-remove-worktree-confirm')}
              destructive
              onCancel={() => closeDialog('removeConfirm')}
              onConfirm={() => closeDialog('removeConfirm')}
            />
          )
        }
        return (
          <ConfirmDialog
            open={removeConfirm !== null && removeConfirmView.liveContext !== null}
            title={t('action.confirm-remove-worktree-title')}
            message={
              <RemoveWorktreeConfirmBody
                body={t('action.confirm-remove-worktree-body')}
                path={formatWorktreePath(
                  entry.payload.path,
                  remoteRepoTarget(displayContext.repo.id, displayContext.repo.remote.lifecycle),
                )}
                branch={entry.payload.branch}
                protectedHint={t('action.confirm-remove-worktree-protected-hint')}
                removeAlsoDeletes={displayCheckboxes.removeAlsoDeletes}
                removeConfirmProtected={removeConfirmProtected}
                hasUpstream={hasUpstream(displayContext.branch)}
                tracking={displayContext.branch.tracking}
                removeAlsoUpstream={displayCheckboxes.removeAlsoUpstream}
                onRemoveAlsoDeletesChange={(value) =>
                  setRemoveAlsoDeletes(entry.repoId, entry.branchName, value)
                }
                onRemoveAlsoUpstreamChange={(value) =>
                  setRemoveAlsoUpstream(entry.repoId, entry.branchName, value)
                }
                alsoDeleteBranchLabel={t('action.confirm-remove-worktree-also-delete-branch')}
                alsoDeleteUpstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
              />
            }
            confirmLabel={t('action.confirm-remove-worktree-confirm')}
            destructive
            onCancel={() => closeDialog('removeConfirm')}
            onConfirm={() => {
              const liveContext = removeConfirmView.liveContext
              if (!liveContext) {
                closeDialog('removeConfirm')
                return
              }
              closeDialog('removeConfirm')
              dispatchRemoveWorktree({
                repo: liveContext.repo,
                target: entry.payload,
                alsoDeleteBranch: displayCheckboxes.removeAlsoDeletes,
                forceDeleteBranch: false,
                alsoDeleteUpstream: displayCheckboxes.removeAlsoUpstream,
              })
            }}
          />
        )
      })()}

      {(() => {
        const { entry, displayContext, displayCheckboxes } = forceRemoveConfirmView
        if (!entry || !displayContext) {
          return (
            <ConfirmDialog
              open={forceRemoveConfirm !== null && forceRemoveConfirmView.liveContext !== null}
              title=""
              message=""
              confirmLabel={t('action.confirm-force-delete-branch-confirm')}
              destructive
              onCancel={() => closeDialog('forceRemoveConfirm')}
              onConfirm={() => closeDialog('forceRemoveConfirm')}
            />
          )
        }
        return (
          <ConfirmDialog
            open={forceRemoveConfirm !== null && forceRemoveConfirmView.liveContext !== null}
            title={t('action.confirm-force-delete-branch-title')}
            message={
              <ForceRemoveWorktreeConfirmBody
                removeBody={t('action.confirm-remove-worktree-body')}
                path={formatWorktreePath(
                  entry.payload.path,
                  remoteRepoTarget(displayContext.repo.id, displayContext.repo.remote.lifecycle),
                )}
                forceDeleteBody={t('action.confirm-force-delete-branch-body')}
                branch={entry.payload.branch}
                note={t('action.confirm-force-delete-branch-note')}
                hasUpstream={hasUpstream(displayContext.branch)}
                tracking={displayContext.branch.tracking}
                removeAlsoUpstream={displayCheckboxes.removeAlsoUpstream}
                onRemoveAlsoUpstreamChange={(value) =>
                  setRemoveAlsoUpstream(entry.repoId, entry.branchName, value)
                }
                alsoDeleteUpstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
              />
            }
            confirmLabel={t('action.confirm-force-delete-branch-confirm')}
            destructive
            onCancel={() => closeDialog('forceRemoveConfirm')}
            onConfirm={() => {
              const liveContext = forceRemoveConfirmView.liveContext
              if (!liveContext) {
                closeDialog('forceRemoveConfirm')
                return
              }
              closeDialog('forceRemoveConfirm')
              dispatchRemoveWorktree({
                repo: liveContext.repo,
                target: entry.payload,
                alsoDeleteBranch: true,
                forceDeleteBranch: true,
                alsoDeleteUpstream: displayCheckboxes.removeAlsoUpstream,
              })
            }}
          />
        )
      })()}
    </>
  )
}