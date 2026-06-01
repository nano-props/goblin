import { type ReactNode } from 'react'
import { Trans } from 'react-i18next'
import { ConfirmCheckbox } from '#/renderer/components/ConfirmCheckbox.tsx'
import { ConfirmDialog } from '#/renderer/components/ConfirmDialog.tsx'
import { formatWorktreePath } from '#/renderer/lib/paths.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import type { RepoBranchState } from '#/renderer/stores/repos/types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

export interface RemoveConfirm {
  branch: string
  path: string
}

interface RetainedDialogViewState<T> {
  open: boolean
  payload: T | null
  close: () => void
}

interface BranchActionDialogsProps {
  branch: RepoBranchState
  remoteTarget?: RemoteRepoTarget
  hasUpstream: boolean
  pushConfirm: RetainedDialogViewState<string>
  deleteConfirm: RetainedDialogViewState<string>
  forceDeleteConfirm: RetainedDialogViewState<string>
  removeConfirm: RetainedDialogViewState<RemoveConfirm>
  forceRemoveConfirm: RetainedDialogViewState<RemoveConfirm>
  deleteAlsoUpstream: boolean
  removeAlsoDeletes: boolean
  removeAlsoUpstream: boolean
  setDeleteAlsoUpstream: (checked: boolean) => void
  setRemoveAlsoDeletes: (checked: boolean) => void
  setRemoveAlsoUpstream: (checked: boolean) => void
  onPushConfirm: (target: string) => void
  onDeleteBranch: (target: string, force: boolean, alsoDeleteUpstream: boolean) => void
  onRemoveWorktree: (
    target: RemoveConfirm,
    alsoDeleteBranch: boolean,
    forceDeleteBranch: boolean,
    alsoDeleteUpstream: boolean,
  ) => void
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

export function BranchActionDialogs({
  branch,
  remoteTarget,
  hasUpstream,
  pushConfirm,
  deleteConfirm,
  forceDeleteConfirm,
  removeConfirm,
  forceRemoveConfirm,
  deleteAlsoUpstream,
  removeAlsoDeletes,
  removeAlsoUpstream,
  setDeleteAlsoUpstream,
  setRemoveAlsoDeletes,
  setRemoveAlsoUpstream,
  onPushConfirm,
  onDeleteBranch,
  onRemoveWorktree,
}: BranchActionDialogsProps) {
  const t = useT()
  const removeConfirmProtected = removeConfirm.payload ? PROTECTED_BRANCHES.has(removeConfirm.payload.branch) : false

  return (
    <>
      <ConfirmDialog
        open={pushConfirm.open}
        title={pushConfirm.payload ? t('action.confirm-push-protected-title', { branch: pushConfirm.payload }) : ''}
        message={
          pushConfirm.payload ? (
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
        onCancel={pushConfirm.close}
        onConfirm={() => {
          const target = pushConfirm.payload
          pushConfirm.close()
          if (target) onPushConfirm(target)
        }}
      />
      <ConfirmDialog
        open={deleteConfirm.open}
        title={deleteConfirm.payload ? t('action.confirm-delete-branch-title') : ''}
        message={
          deleteConfirm.payload ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-delete-branch-body')}
              branchName={deleteConfirm.payload}
              note={t('action.confirm-delete-branch-note')}
              hasUpstream={hasUpstream}
              deleteAlsoUpstream={deleteAlsoUpstream}
              tracking={branch.tracking}
              onDeleteAlsoUpstreamChange={setDeleteAlsoUpstream}
              upstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-delete-branch-confirm')}
        destructive
        onCancel={deleteConfirm.close}
        onConfirm={() => {
          const target = deleteConfirm.payload
          const upstream = deleteAlsoUpstream
          deleteConfirm.close()
          if (target) onDeleteBranch(target, false, upstream)
        }}
      />
      <ConfirmDialog
        open={forceDeleteConfirm.open}
        title={forceDeleteConfirm.payload ? t('action.confirm-force-delete-standalone-title') : ''}
        message={
          forceDeleteConfirm.payload ? (
            <DeleteBranchConfirmBody
              body={t('action.confirm-force-delete-standalone-body')}
              branchName={forceDeleteConfirm.payload}
              note={t('action.confirm-force-delete-standalone-note')}
              hasUpstream={hasUpstream}
              deleteAlsoUpstream={deleteAlsoUpstream}
              tracking={branch.tracking}
              onDeleteAlsoUpstreamChange={setDeleteAlsoUpstream}
              upstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-force-delete-standalone-confirm')}
        destructive
        onCancel={forceDeleteConfirm.close}
        onConfirm={() => {
          const target = forceDeleteConfirm.payload
          const upstream = deleteAlsoUpstream
          forceDeleteConfirm.close()
          if (target) onDeleteBranch(target, true, upstream)
        }}
      />
      <ConfirmDialog
        open={removeConfirm.open}
        title={removeConfirm.payload ? t('action.confirm-remove-worktree-title') : ''}
        message={
          removeConfirm.payload ? (
            <RemoveWorktreeConfirmBody
              body={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(removeConfirm.payload.path, remoteTarget)}
              branch={removeConfirm.payload.branch}
              protectedHint={t('action.confirm-remove-worktree-protected-hint')}
              removeAlsoDeletes={removeAlsoDeletes}
              removeConfirmProtected={removeConfirmProtected}
              hasUpstream={hasUpstream}
              tracking={branch.tracking}
              removeAlsoUpstream={removeAlsoUpstream}
              onRemoveAlsoDeletesChange={setRemoveAlsoDeletes}
              onRemoveAlsoUpstreamChange={setRemoveAlsoUpstream}
              alsoDeleteBranchLabel={t('action.confirm-remove-worktree-also-delete-branch')}
              alsoDeleteUpstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-remove-worktree-confirm')}
        destructive
        onCancel={removeConfirm.close}
        onConfirm={() => {
          const target = removeConfirm.payload
          const alsoDelete = removeAlsoDeletes
          const upstream = removeAlsoUpstream
          removeConfirm.close()
          if (target) onRemoveWorktree(target, alsoDelete, false, upstream)
        }}
      />
      <ConfirmDialog
        open={forceRemoveConfirm.open}
        title={forceRemoveConfirm.payload ? t('action.confirm-force-delete-branch-title') : ''}
        message={
          forceRemoveConfirm.payload ? (
            <ForceRemoveWorktreeConfirmBody
              removeBody={t('action.confirm-remove-worktree-body')}
              path={formatWorktreePath(forceRemoveConfirm.payload.path, remoteTarget)}
              forceDeleteBody={t('action.confirm-force-delete-branch-body')}
              branch={forceRemoveConfirm.payload.branch}
              note={t('action.confirm-force-delete-branch-note')}
              hasUpstream={hasUpstream}
              tracking={branch.tracking}
              removeAlsoUpstream={removeAlsoUpstream}
              onRemoveAlsoUpstreamChange={setRemoveAlsoUpstream}
              alsoDeleteUpstreamLabel={t('action.confirm-delete-branch-also-delete-upstream')}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-force-delete-branch-confirm')}
        destructive
        onCancel={forceRemoveConfirm.close}
        onConfirm={() => {
          const target = forceRemoveConfirm.payload
          const upstream = removeAlsoUpstream
          forceRemoveConfirm.close()
          if (target) onRemoveWorktree(target, true, true, upstream)
        }}
      />
    </>
  )
}
