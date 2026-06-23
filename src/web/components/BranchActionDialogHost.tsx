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
// looked up in `useReposStore`. This means:
//   * The user can open a confirmation for a non-selected branch
//     row (e.g. a row in the focus-mode HoverCard popover) and
//     confirm against the right branch data, not the workspace's
//     selected branch.
//   * When the user switches active repo or selected branch, the
//     `closeStaleDialogs` effect below closes any open dialog
//     whose `(repoId, branchName)` no longer matches — no stale
//     "Delete worktree for branch X" dialog can be confirmed
//     against repo B's cwd.

import { Trans } from 'react-i18next'
import { type ReactNode } from 'react'
import { useEffect } from 'react'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { formatWorktreePath } from '#/web/lib/paths.ts'
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import { useT } from '#/web/stores/i18n.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import {
  branchCheckboxesFor,
  useBranchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/repos/branch-action-dialogs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  dispatchConfirmPush,
  dispatchDeleteBranch,
  dispatchRemoveWorktree,
} from '#/web/hooks/branchActionDispatch.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
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

  // Resolve the (repo, branch) for each open slot from the store
  // payload. The host never uses its own (activeRepo, activeBranch)
  // for rendering context — every slot is rendered with its own
  // payload's branch, so the user can confirm against the right
  // branch data even if the dialog was opened for a non-selected
  // row.
  const repos = useReposStore((s) => s.repos)
  const resolveContext = (repoId: string, branchName: string) => {
    const repo = repos[repoId]
    if (!repo) return null
    const branch = repo.data.branches.find((b) => b.name === branchName)
    if (!branch) return null
    return { repo, branch }
  }

  const pushConfirmCtx = pushConfirm ? resolveContext(pushConfirm.repoId, pushConfirm.branchName) : null
  const deleteConfirmCtx = deleteConfirm ? resolveContext(deleteConfirm.repoId, deleteConfirm.branchName) : null
  const forceDeleteConfirmCtx = forceDeleteConfirm
    ? resolveContext(forceDeleteConfirm.repoId, forceDeleteConfirm.branchName)
    : null
  const removeConfirmCtx = removeConfirm ? resolveContext(removeConfirm.repoId, removeConfirm.branchName) : null
  const forceRemoveConfirmCtx = forceRemoveConfirm
    ? resolveContext(forceRemoveConfirm.repoId, forceRemoveConfirm.branchName)
    : null

  // Pre-compute per-slot display data. Each slot's checkbox state and
  // `hasUpstream` / `tracking` are read from the slot's payload's
  // `(repoId, branchName)`, not the host's active workspace. This is
  // the key fix for the cross-branch bug: opening a dialog for branch
  // Y while the workspace is on X shows Y's tracking data and writes
  // Y's checkbox preferences, not X's.
  const pushConfirmCheckbox = useBranchActionDialogsStore((s) =>
    pushConfirm ? branchCheckboxesFor(s, pushConfirm.repoId, pushConfirm.branchName) : null,
  )
  const deleteConfirmCheckbox = useBranchActionDialogsStore((s) =>
    deleteConfirm ? branchCheckboxesFor(s, deleteConfirm.repoId, deleteConfirm.branchName) : null,
  )
  const forceDeleteConfirmCheckbox = useBranchActionDialogsStore((s) =>
    forceDeleteConfirm ? branchCheckboxesFor(s, forceDeleteConfirm.repoId, forceDeleteConfirm.branchName) : null,
  )
  const removeConfirmCheckbox = useBranchActionDialogsStore((s) =>
    removeConfirm ? branchCheckboxesFor(s, removeConfirm.repoId, removeConfirm.branchName) : null,
  )
  const forceRemoveConfirmCheckbox = useBranchActionDialogsStore((s) =>
    forceRemoveConfirm ? branchCheckboxesFor(s, forceRemoveConfirm.repoId, forceRemoveConfirm.branchName) : null,
  )

  const removeConfirmProtected = removeConfirm
    ? PROTECTED_BRANCHES.has(removeConfirm.payload.branch)
    : false

  return (
    <>
      <ConfirmDialog
        open={pushConfirm !== null && pushConfirmCtx !== null}
        title={pushConfirm ? t('action.confirm-push-protected-title', { branch: pushConfirm.payload }) : ''}
        message={
          pushConfirm ? (
            <Trans
              i18nKey="action.confirm-push-protected-body"
              values={{ branch: pushConfirm.payload }}
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
          const entry = pushConfirm
          closeDialog('pushConfirm')
          if (entry && pushConfirmCtx) {
            dispatchConfirmPush({ repo: pushConfirmCtx.repo, branchName: entry.payload })
          }
        }}
      />

      <ConfirmDialog
        open={deleteConfirm !== null && deleteConfirmCtx !== null}
        title={deleteConfirm ? t('action.confirm-delete-branch-title') : ''}
        message={
          deleteConfirm && deleteConfirmCtx ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-delete-branch-body')}
              branchName={deleteConfirm.payload}
              note={t('action.confirm-delete-branch-note')}
              hasUpstream={hasUpstream(deleteConfirmCtx.branch)}
              deleteAlsoUpstream={deleteConfirmCheckbox?.deleteAlsoUpstream ?? false}
              tracking={deleteConfirmCtx.branch.tracking}
              onDeleteAlsoUpstreamChange={(value) =>
                setDeleteAlsoUpstream(deleteConfirm.repoId, deleteConfirm.branchName, value)
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
          const entry = deleteConfirm
          const ctx = deleteConfirmCtx
          const upstream = deleteConfirmCheckbox?.deleteAlsoUpstream ?? false
          closeDialog('deleteConfirm')
          if (entry && ctx) {
            dispatchDeleteBranch({
              repo: ctx.repo,
              branchName: entry.payload,
              force: false,
              alsoDeleteUpstream: upstream,
            })
          }
        }}
      />

      <ConfirmDialog
        open={forceDeleteConfirm !== null && forceDeleteConfirmCtx !== null}
        title={forceDeleteConfirm ? t('action.confirm-force-delete-unmerged-title') : ''}
        message={
          forceDeleteConfirm && forceDeleteConfirmCtx ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-force-delete-unmerged-body')}
              branchName={forceDeleteConfirm.payload}
              note={t('action.confirm-force-delete-unmerged-note')}
              hasUpstream={hasUpstream(forceDeleteConfirmCtx.branch)}
              deleteAlsoUpstream={forceDeleteConfirmCheckbox?.deleteAlsoUpstream ?? false}
              tracking={forceDeleteConfirmCtx.branch.tracking}
              onDeleteAlsoUpstreamChange={(value) =>
                setDeleteAlsoUpstream(forceDeleteConfirm.repoId, forceDeleteConfirm.branchName, value)
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
          const entry = forceDeleteConfirm
          const ctx = forceDeleteConfirmCtx
          const upstream = forceDeleteConfirmCheckbox?.deleteAlsoUpstream ?? false
          closeDialog('forceDeleteConfirm')
          if (entry && ctx) {
            dispatchDeleteBranch({
              repo: ctx.repo,
              branchName: entry.payload,
              force: true,
              alsoDeleteUpstream: upstream,
            })
          }
        }}
      />

      <ConfirmDialog
        open={removeConfirm !== null && removeConfirmCtx !== null}
        title={removeConfirm ? t('action.confirm-remove-worktree-title') : ''}
        message={
          removeConfirm && removeConfirmCtx ? (
            <RemoveWorktreeConfirmBody
              body={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(
                removeConfirm.payload.path,
                remoteRepoTarget(removeConfirmCtx.repo.id, removeConfirmCtx.repo.remote.lifecycle),
              )}
              branch={removeConfirm.payload.branch}
              protectedHint={t('action.confirm-remove-worktree-protected-hint')}
              removeAlsoDeletes={removeConfirmCheckbox?.removeAlsoDeletes ?? false}
              removeConfirmProtected={removeConfirmProtected}
              hasUpstream={hasUpstream(removeConfirmCtx.branch)}
              tracking={removeConfirmCtx.branch.tracking}
              removeAlsoUpstream={removeConfirmCheckbox?.removeAlsoUpstream ?? false}
              onRemoveAlsoDeletesChange={(value) =>
                setRemoveAlsoDeletes(removeConfirm.repoId, removeConfirm.branchName, value)
              }
              onRemoveAlsoUpstreamChange={(value) =>
                setRemoveAlsoUpstream(removeConfirm.repoId, removeConfirm.branchName, value)
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
          const entry = removeConfirm
          const ctx = removeConfirmCtx
          if (!entry || !ctx) {
            closeDialog('removeConfirm')
            return
          }
          const alsoDelete = removeConfirmCheckbox?.removeAlsoDeletes ?? false
          const upstream = removeConfirmCheckbox?.removeAlsoUpstream ?? false
          closeDialog('removeConfirm')
          dispatchRemoveWorktree({
            repo: ctx.repo,
            target: entry.payload,
            alsoDeleteBranch: alsoDelete,
            forceDeleteBranch: false,
            alsoDeleteUpstream: upstream,
          })
        }}
      />

      <ConfirmDialog
        open={forceRemoveConfirm !== null && forceRemoveConfirmCtx !== null}
        title={forceRemoveConfirm ? t('action.confirm-force-delete-branch-title') : ''}
        message={
          forceRemoveConfirm && forceRemoveConfirmCtx ? (
            <ForceRemoveWorktreeConfirmBody
              removeBody={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(
                forceRemoveConfirm.payload.path,
                remoteRepoTarget(forceRemoveConfirmCtx.repo.id, forceRemoveConfirmCtx.repo.remote.lifecycle),
              )}
              forceDeleteBody={t('action.confirm-force-delete-branch-body')}
              branch={forceRemoveConfirm.payload.branch}
              note={t('action.confirm-force-delete-branch-note')}
              hasUpstream={hasUpstream(forceRemoveConfirmCtx.branch)}
              tracking={forceRemoveConfirmCtx.branch.tracking}
              removeAlsoUpstream={forceRemoveConfirmCheckbox?.removeAlsoUpstream ?? false}
              onRemoveAlsoUpstreamChange={(value) =>
                setRemoveAlsoUpstream(forceRemoveConfirm.repoId, forceRemoveConfirm.branchName, value)
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
          const entry = forceRemoveConfirm
          const ctx = forceRemoveConfirmCtx
          if (!entry || !ctx) {
            closeDialog('forceRemoveConfirm')
            return
          }
          const upstream = forceRemoveConfirmCheckbox?.removeAlsoUpstream ?? false
          closeDialog('forceRemoveConfirm')
          dispatchRemoveWorktree({
            repo: ctx.repo,
            target: entry.payload,
            alsoDeleteBranch: true,
            forceDeleteBranch: true,
            alsoDeleteUpstream: upstream,
          })
        }}
      />
    </>
  )
}

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
