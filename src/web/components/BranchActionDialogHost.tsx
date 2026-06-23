// Workspace-level host for the five branch action confirmation
// dialogs (push / delete branch / force-delete / remove worktree /
// force-remove worktree). State lives in `useBranchActionDialogsStore`,
// not in component local state, so a confirmation requested from a
// temporary surface (e.g. the focus-mode HoverCard popover) survives
// the surface unmounting.
//
// Mount once per visible BranchWorkspace. Multiple mounts are safe:
// the store keeps a single open-dialog slot, so only one dialog is
// rendered at a time across the entire app regardless of how many
// hosts are alive.

import { Trans } from 'react-i18next'
import { type ReactNode } from 'react'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'
import { formatWorktreePath } from '#/web/lib/paths.ts'
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import {
  branchCheckboxesFor,
  useBranchActionDialogsStore,
  type RemoveWorktreeDialogPayload,
} from '#/web/stores/repos/branch-action-dialogs.ts'

interface Props {
  repo: BranchActionRepo
  branch: RepoBranchState
}

export function BranchActionDialogHost({ repo, branch }: Props): ReactNode {
  const t = useT()

  // One subscription per slot — re-renders are scoped to the dialog
  // that actually changed, not the whole host.
  const pushConfirm = useBranchActionDialogsStore((s) => s.pushConfirm)
  const deleteConfirm = useBranchActionDialogsStore((s) => s.deleteConfirm)
  const forceDeleteConfirm = useBranchActionDialogsStore((s) => s.forceDeleteConfirm)
  const removeConfirm = useBranchActionDialogsStore((s) => s.removeConfirm)
  const forceRemoveConfirm = useBranchActionDialogsStore((s) => s.forceRemoveConfirm)
  const checkboxState = useBranchActionDialogsStore((s) =>
    branchCheckboxesFor(s, repo.id, branch.name),
  )

  // Dispatch callbacks. The duplicate `useBranchActions` call is
  // intentional: the previous design stuffed dialog state inside the
  // hook instance, which forced every caller to share one instance and
  // made the dialog state hostage to whichever surface owned the row.
  // With state moved to the store, each caller can grab its own
  // dispatch methods independently — the only thing they share is the
  // store, which is the point.
  const { deleteBranch, removeWorktree, confirmPush } = useBranchActions(repo, branch)

  const closeDialog = useBranchActionDialogsStore((s) => s.closeDialog)
  const setRemoveAlsoDeletes = useBranchActionDialogsStore((s) => s.setRemoveAlsoDeletes)
  const setRemoveAlsoUpstream = useBranchActionDialogsStore((s) => s.setRemoveAlsoUpstream)
  const setDeleteAlsoUpstream = useBranchActionDialogsStore((s) => s.setDeleteAlsoUpstream)

  const remoteTarget: RemoteRepoTarget | null | undefined = remoteRepoTarget(repo.id, repo.remote.lifecycle)
  const hasUpstream = !!branch.tracking && !branch.trackingGone
  const removeConfirmProtected = removeConfirm
    ? PROTECTED_BRANCHES.has(removeConfirm.payload.branch)
    : false
  const forceRemoveConfirmProtected = forceRemoveConfirm
    ? PROTECTED_BRANCHES.has(forceRemoveConfirm.payload.branch)
    : false

  return (
    <>
      <ConfirmDialog
        open={pushConfirm !== null}
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
          const target = pushConfirm?.payload ?? null
          closeDialog('pushConfirm')
          if (target) confirmPush(target)
        }}
      />

      <ConfirmDialog
        open={deleteConfirm !== null}
        title={deleteConfirm ? t('action.confirm-delete-branch-title') : ''}
        message={
          deleteConfirm ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-delete-branch-body')}
              branchName={deleteConfirm.payload}
              note={t('action.confirm-delete-branch-note')}
              hasUpstream={hasUpstream}
              deleteAlsoUpstream={checkboxState.deleteAlsoUpstream}
              tracking={branch.tracking}
              onDeleteAlsoUpstreamChange={(value) => setDeleteAlsoUpstream(repo.id, branch.name, value)}
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
          const target = deleteConfirm?.payload ?? null
          const upstream = checkboxState.deleteAlsoUpstream
          closeDialog('deleteConfirm')
          if (target) deleteBranch(target, false, upstream)
        }}
      />

      <ConfirmDialog
        open={forceDeleteConfirm !== null}
        title={forceDeleteConfirm ? t('action.confirm-force-delete-unmerged-title') : ''}
        message={
          forceDeleteConfirm ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-force-delete-unmerged-body')}
              branchName={forceDeleteConfirm.payload}
              note={t('action.confirm-force-delete-unmerged-note')}
              hasUpstream={hasUpstream}
              deleteAlsoUpstream={checkboxState.deleteAlsoUpstream}
              tracking={branch.tracking}
              onDeleteAlsoUpstreamChange={(value) => setDeleteAlsoUpstream(repo.id, branch.name, value)}
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
          const target = forceDeleteConfirm?.payload ?? null
          const upstream = checkboxState.deleteAlsoUpstream
          closeDialog('forceDeleteConfirm')
          if (target) deleteBranch(target, true, upstream)
        }}
      />

      <ConfirmDialog
        open={removeConfirm !== null}
        title={removeConfirm ? t('action.confirm-remove-worktree-title') : ''}
        message={
          removeConfirm ? (
            <RemoveWorktreeConfirmBody
              body={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(removeConfirm.payload.path, remoteTarget)}
              branch={removeConfirm.payload.branch}
              protectedHint={t('action.confirm-remove-worktree-protected-hint')}
              removeAlsoDeletes={checkboxState.removeAlsoDeletes}
              removeConfirmProtected={removeConfirmProtected}
              hasUpstream={hasUpstream}
              tracking={branch.tracking}
              removeAlsoUpstream={checkboxState.removeAlsoUpstream}
              onRemoveAlsoDeletesChange={(value) => setRemoveAlsoDeletes(repo.id, branch.name, value)}
              onRemoveAlsoUpstreamChange={(value) => setRemoveAlsoUpstream(repo.id, branch.name, value)}
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
          const target = removeConfirm?.payload ?? null
          if (!target) {
            closeDialog('removeConfirm')
            return
          }
          const alsoDelete = checkboxState.removeAlsoDeletes
          const upstream = checkboxState.removeAlsoUpstream
          closeDialog('removeConfirm')
          removeWorktree(target, alsoDelete, false, upstream)
        }}
      />

      <ConfirmDialog
        open={forceRemoveConfirm !== null}
        title={forceRemoveConfirm ? t('action.confirm-force-delete-branch-title') : ''}
        message={
          forceRemoveConfirm ? (
            <ForceRemoveWorktreeConfirmBody
              removeBody={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(forceRemoveConfirm.payload.path, remoteTarget)}
              forceDeleteBody={t('action.confirm-force-delete-branch-body')}
              branch={forceRemoveConfirm.payload.branch}
              note={t('action.confirm-force-delete-branch-note')}
              hasUpstream={hasUpstream}
              tracking={branch.tracking}
              removeAlsoUpstream={checkboxState.removeAlsoUpstream}
              onRemoveAlsoUpstreamChange={(value) => setRemoveAlsoUpstream(repo.id, branch.name, value)}
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
          const target = forceRemoveConfirm?.payload ?? null
          if (!target) {
            closeDialog('forceRemoveConfirm')
            return
          }
          const upstream = checkboxState.removeAlsoUpstream
          closeDialog('forceRemoveConfirm')
          removeWorktree(target, true, true, upstream)
        }}
      />
    </>
  )
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

// Re-export the payload shape so external callers (e.g. tests) can
// import the canonical name without reaching into the store file.
export type { RemoveWorktreeDialogPayload }