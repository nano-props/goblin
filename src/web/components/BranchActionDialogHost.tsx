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
// Unlike the previous workspace-mounted iteration, this host does NOT
// close over a `(repo, branch)` for dispatch. Every confirmation is
// resolved against the **dialog payload's** `(repoId, branchName)`,
// looked up in `useReposStore` via `useDialogDisplay`. This means:
//   * The user can open a confirmation for a non-selected branch
//     row (e.g. a row in the focus-mode HoverCard popover) and
//     confirm against the right branch data, not the workspace's
//     selected branch.
//   * When the user switches active repo or selected branch, the
//     `closeStaleDialogs` effect below closes any open dialog
//     whose `(repoId, branchName)` no longer matches — no stale
//     "Delete worktree for branch X" dialog can be confirmed
//     against repo B's cwd.
//
// Data flow: for each slot, the host subscribes to the raw slot
// (drives Radix's `open` prop) and calls `useDialogDisplay(slot)`
// for the body-visible data (title, message, checkbox state). The
// display hook retains its entry across close so the inner content
// stays rendered for the duration of the Radix close animation. See
// `web/hooks/useDialogDisplay.ts` for the retention contract.

import { Trans } from 'react-i18next'
import { type ReactNode } from 'react'
import { useEffect } from 'react'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { formatWorktreePath } from '#/web/lib/paths.ts'
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import { useT } from '#/web/stores/i18n.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import { useBranchActionDialogsStore } from '#/web/stores/repos/branch-action-dialogs.ts'
import {
  dispatchConfirmPush,
  dispatchDeleteBranch,
  dispatchRemoveWorktree,
} from '#/web/hooks/branchActionDispatch.ts'
import { useDialogDisplay } from '#/web/hooks/useDialogDisplay.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

interface Props {
  /**
   * The currently active `(repoId, branchName)`. Used as the key
   * for `closeStaleDialogs` and as a fallback when a dialog slot
   * is open but its payload's branch is missing from the repo
   * (e.g. the branch was deleted upstream). Pass `null` when no
   * repo is active — the host renders nothing.
   */
  activeRepoId: string | null
  activeBranchName: string | null
}

export function BranchActionDialogHost({ activeRepoId, activeBranchName }: Props): ReactNode {
  const t = useT()

  // One subscription per slot — re-renders are scoped to the dialog
  // that actually changed, not the whole host. The host still
  // re-renders as a whole when any slot changes (no React.memo on
  // the children), so all five `<ConfirmDialog>` instances below are
  // re-evaluated; Radix renders nothing visible for `open={false}`
  // dialogs, so the per-dialog cost is small.
  const pushConfirm = useBranchActionDialogsStore((s) => s.pushConfirm)
  const deleteConfirm = useBranchActionDialogsStore((s) => s.deleteConfirm)
  const forceDeleteConfirm = useBranchActionDialogsStore((s) => s.forceDeleteConfirm)
  const removeConfirm = useBranchActionDialogsStore((s) => s.removeConfirm)
  const forceRemoveConfirm = useBranchActionDialogsStore((s) => s.forceRemoveConfirm)

  // Store actions. Functions are stable references defined once at
  // store creation, so subscribing to them is a no-op for re-render
  // purposes but keeps the access pattern consistent.
  const closeDialog = useBranchActionDialogsStore((s) => s.closeDialog)
  const closeStaleDialogs = useBranchActionDialogsStore((s) => s.closeStaleDialogs)
  const setRemoveAlsoDeletes = useBranchActionDialogsStore((s) => s.setRemoveAlsoDeletes)
  const setRemoveAlsoUpstream = useBranchActionDialogsStore((s) => s.setRemoveAlsoUpstream)
  const setDeleteAlsoUpstream = useBranchActionDialogsStore((s) => s.setDeleteAlsoUpstream)

  // Auto-close any dialog whose (repoId, branchName) no longer
  // matches the active workspace. Runs on active-repo / active-branch
  // change. Setting the dep array to `[activeRepoId, activeBranchName]`
  // (not including `closeStaleDialogs` since the action function is
  // a stable reference) means the effect fires exactly when the
  // active workspace changes — not when the user opens or closes a
  // dialog.
  useEffect(() => {
    if (activeRepoId === null || activeBranchName === null) {
      // No active workspace — close any open dialog to avoid
      // leaving the user with a dialog whose dispatch would target
      // a stale repo.
      useBranchActionDialogsStore.getState().closeStaleDialogs('', '')
      return
    }
    closeStaleDialogs(activeRepoId, activeBranchName)
  }, [activeRepoId, activeBranchName, closeStaleDialogs])

  // Per-slot display view. Each view bundles:
  //   - `liveCtx`: the resolved (repo, branch) for the *live* slot;
  //     null when the slot is null or its branch is gone from the
  //     repo. Drives the `open` prop on `<AlertDialog>`.
  //   - `display`: the retained entry (last non-null slot). Drives
  //     the body's title, message, and checkbox identity.
  //   - `displayCtx`: the resolved (repo, branch) for the retained
  //     entry. Drives the body's `hasUpstream` / `tracking` reads.
  //   - `displayCheckbox`: the persisted checkbox state for the
  //     entry's (repoId, branchName), retained across close so the
  //     user's last choice stays rendered during the close animation.
  // See `web/hooks/useDialogDisplay.ts` for the retention contract.
  const pushConfirmView = useDialogDisplay(pushConfirm)
  const deleteConfirmView = useDialogDisplay(deleteConfirm)
  const forceDeleteConfirmView = useDialogDisplay(forceDeleteConfirm)
  const removeConfirmView = useDialogDisplay(removeConfirm)
  const forceRemoveConfirmView = useDialogDisplay(forceRemoveConfirm)

  // Protected-branch read for the remove-worktree body. Derived from
  // the *retained* display entry so the checkbox-disabled state and
  // the hint block stay stable across the close animation (closing
  // `removeConfirm` would otherwise null the source and flip the
  // body's structural conditionals during the fade-out).
  const removeConfirmProtected = removeConfirmView.display
    ? PROTECTED_BRANCHES.has(removeConfirmView.display.payload.branch)
    : false

  return (
    <>
      <ConfirmDialog
        open={pushConfirm !== null && pushConfirmView.liveCtx !== null}
        title={
          pushConfirmView.display
            ? t('action.confirm-push-protected-title', { branch: pushConfirmView.display.payload })
            : ''
        }
        message={
          pushConfirmView.display ? (
            <Trans
              i18nKey="action.confirm-push-protected-body"
              values={{ branch: pushConfirmView.display.payload }}
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
          const { display, liveCtx } = pushConfirmView
          closeDialog('pushConfirm')
          if (display && liveCtx) {
            dispatchConfirmPush({ repo: liveCtx.repo, branchName: display.payload })
          }
        }}
      />

      <ConfirmDialog
        open={deleteConfirm !== null && deleteConfirmView.liveCtx !== null}
        title={deleteConfirmView.display ? t('action.confirm-delete-branch-title') : ''}
        message={
          deleteConfirmView.display && deleteConfirmView.displayCtx ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-delete-branch-body')}
              branchName={deleteConfirmView.display.payload}
              note={t('action.confirm-delete-branch-note')}
              hasUpstream={hasUpstream(deleteConfirmView.displayCtx.branch)}
              deleteAlsoUpstream={deleteConfirmView.displayCheckbox.deleteAlsoUpstream}
              tracking={deleteConfirmView.displayCtx.branch.tracking}
              onDeleteAlsoUpstreamChange={(value) =>
                setDeleteAlsoUpstream(
                  deleteConfirmView.display!.repoId,
                  deleteConfirmView.display!.branchName,
                  value,
                )
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
          const { display, liveCtx, displayCheckbox } = deleteConfirmView
          closeDialog('deleteConfirm')
          if (display && liveCtx) {
            dispatchDeleteBranch({
              repo: liveCtx.repo,
              branchName: display.payload,
              force: false,
              alsoDeleteUpstream: displayCheckbox.deleteAlsoUpstream,
            })
          }
        }}
      />

      <ConfirmDialog
        open={forceDeleteConfirm !== null && forceDeleteConfirmView.liveCtx !== null}
        title={forceDeleteConfirmView.display ? t('action.confirm-force-delete-unmerged-title') : ''}
        message={
          forceDeleteConfirmView.display && forceDeleteConfirmView.displayCtx ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-force-delete-unmerged-body')}
              branchName={forceDeleteConfirmView.display.payload}
              note={t('action.confirm-force-delete-unmerged-note')}
              hasUpstream={hasUpstream(forceDeleteConfirmView.displayCtx.branch)}
              deleteAlsoUpstream={forceDeleteConfirmView.displayCheckbox.deleteAlsoUpstream}
              tracking={forceDeleteConfirmView.displayCtx.branch.tracking}
              onDeleteAlsoUpstreamChange={(value) =>
                setDeleteAlsoUpstream(
                  forceDeleteConfirmView.display!.repoId,
                  forceDeleteConfirmView.display!.branchName,
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
          const { display, liveCtx, displayCheckbox } = forceDeleteConfirmView
          closeDialog('forceDeleteConfirm')
          if (display && liveCtx) {
            dispatchDeleteBranch({
              repo: liveCtx.repo,
              branchName: display.payload,
              force: true,
              alsoDeleteUpstream: displayCheckbox.deleteAlsoUpstream,
            })
          }
        }}
      />

      <ConfirmDialog
        open={removeConfirm !== null && removeConfirmView.liveCtx !== null}
        title={removeConfirmView.display ? t('action.confirm-remove-worktree-title') : ''}
        message={
          removeConfirmView.display && removeConfirmView.displayCtx ? (
            <RemoveWorktreeConfirmBody
              body={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(
                removeConfirmView.display.payload.path,
                remoteRepoTarget(
                  removeConfirmView.displayCtx.repo.id,
                  removeConfirmView.displayCtx.repo.remote.lifecycle,
                ),
              )}
              branch={removeConfirmView.display.payload.branch}
              protectedHint={t('action.confirm-remove-worktree-protected-hint')}
              removeAlsoDeletes={removeConfirmView.displayCheckbox.removeAlsoDeletes}
              removeConfirmProtected={removeConfirmProtected}
              hasUpstream={hasUpstream(removeConfirmView.displayCtx.branch)}
              tracking={removeConfirmView.displayCtx.branch.tracking}
              removeAlsoUpstream={removeConfirmView.displayCheckbox.removeAlsoUpstream}
              onRemoveAlsoDeletesChange={(value) =>
                setRemoveAlsoDeletes(
                  removeConfirmView.display!.repoId,
                  removeConfirmView.display!.branchName,
                  value,
                )
              }
              onRemoveAlsoUpstreamChange={(value) =>
                setRemoveAlsoUpstream(
                  removeConfirmView.display!.repoId,
                  removeConfirmView.display!.branchName,
                  value,
                )
              }
              alsoDeleteBranchLabel={t('action.confirm-remove-worktree-also-delete-branch')}
              alsoDeleteUpstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-remove-worktree-confirm')}
        destructive
        onCancel={() => closeDialog('removeConfirm')}
        onConfirm={() => {
          const { display, liveCtx, displayCheckbox } = removeConfirmView
          if (!display || !liveCtx) {
            closeDialog('removeConfirm')
            return
          }
          closeDialog('removeConfirm')
          dispatchRemoveWorktree({
            repo: liveCtx.repo,
            target: display.payload,
            alsoDeleteBranch: displayCheckbox.removeAlsoDeletes,
            forceDeleteBranch: false,
            alsoDeleteUpstream: displayCheckbox.removeAlsoUpstream,
          })
        }}
      />

      <ConfirmDialog
        open={forceRemoveConfirm !== null && forceRemoveConfirmView.liveCtx !== null}
        title={forceRemoveConfirmView.display ? t('action.confirm-force-delete-branch-title') : ''}
        message={
          forceRemoveConfirmView.display && forceRemoveConfirmView.displayCtx ? (
            <ForceRemoveWorktreeConfirmBody
              removeBody={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(
                forceRemoveConfirmView.display.payload.path,
                remoteRepoTarget(
                  forceRemoveConfirmView.displayCtx.repo.id,
                  forceRemoveConfirmView.displayCtx.repo.remote.lifecycle,
                ),
              )}
              forceDeleteBody={t('action.confirm-force-delete-branch-body')}
              branch={forceRemoveConfirmView.display.payload.branch}
              note={t('action.confirm-force-delete-branch-note')}
              hasUpstream={hasUpstream(forceRemoveConfirmView.displayCtx.branch)}
              tracking={forceRemoveConfirmView.displayCtx.branch.tracking}
              removeAlsoUpstream={forceRemoveConfirmView.displayCheckbox.removeAlsoUpstream}
              onRemoveAlsoUpstreamChange={(value) =>
                setRemoveAlsoUpstream(
                  forceRemoveConfirmView.display!.repoId,
                  forceRemoveConfirmView.display!.branchName,
                  value,
                )
              }
              alsoDeleteUpstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-force-delete-branch-confirm')}
        destructive
        onCancel={() => closeDialog('forceRemoveConfirm')}
        onConfirm={() => {
          const { display, liveCtx, displayCheckbox } = forceRemoveConfirmView
          if (!display || !liveCtx) {
            closeDialog('forceRemoveConfirm')
            return
          }
          closeDialog('forceRemoveConfirm')
          dispatchRemoveWorktree({
            repo: liveCtx.repo,
            target: display.payload,
            alsoDeleteBranch: true,
            forceDeleteBranch: true,
            alsoDeleteUpstream: displayCheckbox.removeAlsoUpstream,
          })
        }}
      />
    </>
  )
}

/**
 * Display-layer retention for the dialog slots lives in
 * `useDialogDisplay` (see `web/hooks/useDialogDisplay.ts`). It
 * combines the per-slot ref retention, the `(repo, branch)` lookup
 * against `useReposStore`, and the persisted-checkbox read from
 * `useBranchActionDialogsStore` into a single view per slot.
 */

function hasUpstream(branch: RepoBranchState): boolean {
  return !!branch.tracking && !branch.trackingGone
}

function ConfirmValue({ value }: { value: string }) {
  return (
    <span className="block break-all font-mono text-foreground" title={value}>
      {value}
    </span>
  )
}

function IndentedValue({ value }: { value: string }) {
  return (
    <span className="block break-all pl-6 font-mono text-foreground" title={value}>
      {value}
    </span>
  )
}

function ConfirmStack({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>
}

function ConfirmSection({ children }: { children: ReactNode }) {
  return <div className="space-y-1">{children}</div>
}

function ConfirmNote({ children }: { children: ReactNode }) {
  return <span className="block text-muted-foreground">{children}</span>
}

function DeleteBranchConfirmBody({
  body,
  branchName,
  note,
  hasUpstream,
  deleteAlsoUpstream,
  tracking,
  onDeleteAlsoUpstreamChange,
  upstreamLabel,
}: {
  body: string
  branchName: string
  note: string
  hasUpstream: boolean
  deleteAlsoUpstream: boolean
  tracking?: string
  onDeleteAlsoUpstreamChange: (checked: boolean) => void
  upstreamLabel: string
}) {
  return (
    <ConfirmStack>
      <ConfirmSection>
        <span>{body}</span>
        <ConfirmValue value={branchName} />
        <ConfirmNote>{note}</ConfirmNote>
      </ConfirmSection>
      {hasUpstream && tracking && (
        <ConfirmSection>
          <ConfirmCheckbox checked={deleteAlsoUpstream} onCheckedChange={onDeleteAlsoUpstreamChange} destructive>
            {upstreamLabel}
          </ConfirmCheckbox>
          <IndentedValue value={tracking} />
        </ConfirmSection>
      )}
    </ConfirmStack>
  )
}

function RemoveWorktreeConfirmBody({
  body,
  path,
  branch,
  protectedHint,
  removeAlsoDeletes,
  removeConfirmProtected,
  hasUpstream,
  tracking,
  removeAlsoUpstream,
  onRemoveAlsoDeletesChange,
  onRemoveAlsoUpstreamChange,
  alsoDeleteBranchLabel,
  alsoDeleteUpstreamLabel,
}: {
  body: string
  path: string
  branch: string
  protectedHint: string
  removeAlsoDeletes: boolean
  removeConfirmProtected: boolean
  hasUpstream: boolean
  tracking?: string
  removeAlsoUpstream: boolean
  onRemoveAlsoDeletesChange: (checked: boolean) => void
  onRemoveAlsoUpstreamChange: (checked: boolean) => void
  alsoDeleteBranchLabel: string
  alsoDeleteUpstreamLabel: string
}) {
  return (
    <ConfirmStack>
      <ConfirmSection>
        <span>{body}</span>
        <ConfirmValue value={path} />
      </ConfirmSection>
      <div className="space-y-2">
        <ConfirmSection>
          <ConfirmCheckbox
            checked={removeAlsoDeletes}
            disabled={removeConfirmProtected}
            describedBy={removeConfirmProtected ? 'remove-worktree-protected-hint' : undefined}
            onCheckedChange={onRemoveAlsoDeletesChange}
            destructive
            title={removeConfirmProtected ? protectedHint : undefined}
          >
            {alsoDeleteBranchLabel}
          </ConfirmCheckbox>
          <IndentedValue value={branch} />
        </ConfirmSection>
        {removeConfirmProtected && (
          <div id="remove-worktree-protected-hint" className="pl-6 text-xs text-muted-foreground">
            {protectedHint}
          </div>
        )}
        {removeAlsoDeletes && hasUpstream && !removeConfirmProtected && tracking && (
          <ConfirmSection>
            <ConfirmCheckbox checked={removeAlsoUpstream} onCheckedChange={onRemoveAlsoUpstreamChange} destructive>
              {alsoDeleteUpstreamLabel}
            </ConfirmCheckbox>
            <IndentedValue value={tracking} />
          </ConfirmSection>
        )}
      </div>
    </ConfirmStack>
  )
}

function ForceRemoveWorktreeConfirmBody({
  removeBody,
  path,
  forceDeleteBody,
  branch,
  note,
  hasUpstream,
  tracking,
  removeAlsoUpstream,
  onRemoveAlsoUpstreamChange,
  alsoDeleteUpstreamLabel,
}: {
  removeBody: string
  path: string
  forceDeleteBody: string
  branch: string
  note: string
  hasUpstream: boolean
  tracking?: string
  removeAlsoUpstream: boolean
  onRemoveAlsoUpstreamChange: (checked: boolean) => void
  alsoDeleteUpstreamLabel: string
}) {
  return (
    <ConfirmStack>
      <ConfirmSection>
        <span>{removeBody}</span>
        <ConfirmValue value={path} />
      </ConfirmSection>
      <ConfirmSection>
        <span>{forceDeleteBody}</span>
        <ConfirmValue value={branch} />
        <ConfirmNote>{note}</ConfirmNote>
      </ConfirmSection>
      {hasUpstream && tracking && (
        <ConfirmSection>
          <ConfirmCheckbox checked={removeAlsoUpstream} onCheckedChange={onRemoveAlsoUpstreamChange} destructive>
            {alsoDeleteUpstreamLabel}
          </ConfirmCheckbox>
          <IndentedValue value={tracking} />
        </ConfirmSection>
      )}
    </ConfirmStack>
  )
}
