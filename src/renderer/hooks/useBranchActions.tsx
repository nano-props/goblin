import { useState } from 'react'
import { Trans } from 'react-i18next'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoBranchState, RepoState } from '#/renderer/stores/repos/types.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { ConfirmDialog } from '#/renderer/components/ConfirmDialog.tsx'
import { ConfirmCheckbox } from '#/renderer/components/ConfirmCheckbox.tsx'
import { tildify } from '#/renderer/lib/paths.ts'
import type { ExecResult } from '#/renderer/types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import { rpc } from '#/renderer/rpc.ts'
import {
  branchActionDisplayPhase,
  branchActionBusyItemId,
  cancelableBranchActionItemId,
  isBranchActionBlocked,
  type BranchActionItemId,
} from '#/renderer/hooks/branch-action-state.ts'
import { useAsyncPending } from '#/renderer/hooks/useAsyncPending.ts'
import { getBranchWorktreeState } from '#/renderer/stores/repos/worktree-state.ts'

export type { BranchActionItemId } from '#/renderer/hooks/branch-action-state.ts'

const SILENT_SUCCESS_OPS = new Set<BranchActionItemId>(['remote', 'terminal', 'editor'])
type LocalBranchActionItemId = 'copyPatch' | 'remote' | 'terminal' | 'editor'

export interface BranchActionCapabilities {
  isCurrent: boolean
  checkedOutInAnotherWorktree: boolean
  canRemoveWorktree: boolean
  isRegularBranch: boolean
  canCopyPatch: boolean
  canPull: boolean
  canPush: boolean
  canOpenRemote: boolean
  canOpenTerminal: boolean
  canOpenEditor: boolean
}

interface RemoveConfirm {
  branch: string
  path: string
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

export function getBranchActionCapabilities(repo: RepoState, branch: RepoBranchState): BranchActionCapabilities {
  const isCurrent = branch.name === repo.data.currentBranch
  const checkedOutInAnotherWorktree = !!branch.worktree?.path && !isCurrent
  const isProtected = PROTECTED_BRANCHES.has(branch.name)
  const isRegularBranch = !isCurrent && !branch.worktree?.path && !isProtected
  const worktreeState = getBranchWorktreeState(repo, branch)
  const canRemoveWorktree = checkedOutInAnotherWorktree && !worktreeState?.isMain
  const canCopyPatch = !!branch.worktree?.path && (worktreeState?.dirty ?? false)
  return {
    isCurrent,
    checkedOutInAnotherWorktree,
    canRemoveWorktree,
    isRegularBranch,
    canCopyPatch,
    canPull: !!branch.tracking,
    canPush: repo.remote.hasRemotes === true,
    canOpenRemote: repo.remote.hasBrowserRemote === true || repo.remote.hasGitHubRemote === true,
    canOpenTerminal: !!branch.worktree?.path,
    canOpenEditor: !!branch.worktree?.path,
  }
}

export function useBranchActions(repo: RepoState, branch: RepoBranchState) {
  const t = useT()
  const setLastResult = useReposStore((s) => s.setLastResult)
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const cancelBranchAction = useReposStore((s) => s.cancelBranchAction)
  const branchActionBusy = isBranchActionBlocked(repo)
  const branchBusyAction = branchActionBusyItemId(repo, branch.name)
  const branchActionPhase = branchActionDisplayPhase(repo, branch.name)
  const cancelableBranchAction = cancelableBranchActionItemId(repo, branch.name)
  const {
    pending: pendingLocalAction,
    hasPending: hasPendingLocalAction,
    run: runPendingLocalAction,
  } = useAsyncPending<LocalBranchActionItemId>()
  const [pushConfirm, setPushConfirm] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [forceDeleteConfirm, setForceDeleteConfirm] = useState<string | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<RemoveConfirm | null>(null)
  const [forceRemoveConfirm, setForceRemoveConfirm] = useState<RemoveConfirm | null>(null)
  const [removeAlsoDeletes, setRemoveAlsoDeletes] = useState(true)
  const [deleteAlsoUpstream, setDeleteAlsoUpstream] = useState(false)
  const [removeAlsoUpstream, setRemoveAlsoUpstream] = useState(false)
  const hasUpstream = !!branch.tracking && !branch.trackingGone

  function runUiAction(
    op: LocalBranchActionItemId,
    fn: () => Promise<ExecResult>,
    options?: { handleResult?: (result: ExecResult) => boolean },
  ) {
    if (branchActionBusy || hasPendingLocalAction()) return
    const pending = runPendingLocalAction(op, async () => {
      const token = repo.instanceToken
      let result: ExecResult
      try {
        result = await fn()
      } catch (err) {
        result = { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
      if (!result.ok && result.message === 'cancelled') return
      if (options?.handleResult?.(result)) return
      const skipSuccessToast = result.ok && SILENT_SUCCESS_OPS.has(op)
      if (!skipSuccessToast) setLastResult(repo.id, result, token)
    })
    if (pending) return Promise.resolve(pending).then(() => undefined)
  }

  async function runRepoAction(
    action: Parameters<typeof runBranchAction>[1],
    options?: { deferResultMessages?: string[]; handleResult?: (result: ExecResult) => boolean },
  ) {
    if (branchActionBusy || hasPendingLocalAction()) return
    const result = await runBranchAction(repo.id, action, {
      token: repo.instanceToken,
      deferResultMessages: options?.deferResultMessages,
    })
    if (!result || (!result.ok && result.message === 'cancelled')) return
    options?.handleResult?.(result)
  }

  function copyPatch() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree?.path
    return runUiAction('copyPatch', async () => {
      const result = await rpc.repo.patch.mutate({ cwd: repo.id, worktreePath })
      if (!result.ok) return { ok: false, message: result.message }
      if (!result.message) return { ok: false, message: 'status.copy-patch-empty' }
      try {
        await navigator.clipboard.writeText(result.message)
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
      return { ok: true, message: 'status.copy-patch-ok' }
    })
  }

  function checkout() {
    return runRepoAction({ kind: 'checkout', branch: branch.name })
  }

  function pull() {
    if (cancelableBranchAction === 'pull' && branchActionPhase !== null) {
      cancelBranchAction(repo.id, { token: repo.instanceToken })
      return
    }
    return runRepoAction({ kind: 'pull', branch: branch.name, worktreePath: branch.worktree?.path })
  }

  function push() {
    if (cancelableBranchAction === 'push' && branchActionPhase !== null) {
      cancelBranchAction(repo.id, { token: repo.instanceToken })
      return
    }
    if (branchActionBusy || hasPendingLocalAction()) return
    if (PROTECTED_BRANCHES.has(branch.name)) {
      setPushConfirm(branch.name)
      return
    }
    return runRepoAction({ kind: 'push', branch: branch.name })
  }

  function openTerminal() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree?.path
    return runUiAction('terminal', () => rpc.repo.openTerminal.mutate({ path: worktreePath }))
  }

  function openEditor() {
    if (!branch.worktree?.path) return
    const worktreePath = branch.worktree?.path
    return runUiAction('editor', () => rpc.repo.openEditor.mutate({ path: worktreePath }))
  }

  function openRemote() {
    return runUiAction('remote', () => rpc.repo.openRemote.mutate({ cwd: repo.id, branch: branch.name }))
  }

  function requestDeleteBranch() {
    if (branchActionBusy || hasPendingLocalAction()) return
    setDeleteAlsoUpstream(false)
    setDeleteConfirm(branch.name)
  }

  function requestRemoveWorktree() {
    if (branchActionBusy || hasPendingLocalAction() || !branch.worktree?.path) return
    setRemoveAlsoDeletes(!PROTECTED_BRANCHES.has(branch.name))
    setRemoveAlsoUpstream(false)
    setRemoveConfirm({ branch: branch.name, path: branch.worktree?.path })
  }

  function deleteBranch(target: string, force = false, alsoDeleteUpstream = false) {
    return runRepoAction(
      { kind: 'deleteBranch', branch: target, force, alsoDeleteUpstream },
      {
        deferResultMessages: force ? [] : ['error.branch-not-fully-merged'],
        handleResult: (result) => {
          if (!force && !result.ok && result.message === 'error.branch-not-fully-merged') {
            setForceDeleteConfirm(target)
            return true
          }
          return false
        },
      },
    )
  }

  function removeWorktree(
    target: RemoveConfirm,
    alsoDeleteBranch: boolean,
    forceDeleteBranch: boolean,
    alsoDeleteUpstream = false,
  ) {
    return runRepoAction(
      {
        kind: 'removeWorktree',
        branch: target.branch,
        worktreePath: target.path,
        alsoDeleteBranch,
        forceDeleteBranch,
        alsoDeleteUpstream,
      },
      {
        deferResultMessages: alsoDeleteBranch && !forceDeleteBranch ? ['error.cannot-remove-unpushed-worktree'] : [],
        handleResult: (result) => {
          if (
            !result.ok &&
            result.message === 'error.cannot-remove-unpushed-worktree' &&
            alsoDeleteBranch &&
            !forceDeleteBranch
          ) {
            setForceRemoveConfirm(target)
            return true
          }
          return false
        },
      },
    )
  }

  const capabilities = getBranchActionCapabilities(repo, branch)
  const removeConfirmProtected = removeConfirm ? PROTECTED_BRANCHES.has(removeConfirm.branch) : false

  const dialogs = (
    <>
      <ConfirmDialog
        open={pushConfirm !== null}
        title={pushConfirm ? t('action.confirm-push-protected-title', { branch: pushConfirm }) : ''}
        message={
          pushConfirm ? (
            <Trans
              i18nKey="action.confirm-push-protected-body"
              values={{ branch: pushConfirm }}
              components={{ branch: <b className="text-foreground" /> }}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-push-confirm')}
        destructive
        onCancel={() => setPushConfirm(null)}
        onConfirm={() => {
          const target = pushConfirm
          setPushConfirm(null)
          if (target) void runRepoAction({ kind: 'push', branch: target })
        }}
      />
      <ConfirmDialog
        open={deleteConfirm !== null}
        title={deleteConfirm ? t('action.confirm-delete-branch-title') : ''}
        message={
          deleteConfirm ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <span>{t('action.confirm-delete-branch-body')}</span>
                <ConfirmValue value={deleteConfirm} />
                <span className="block text-muted-foreground">{t('action.confirm-delete-branch-note')}</span>
              </div>
              {hasUpstream && (
                <div className="space-y-1">
                  <ConfirmCheckbox checked={deleteAlsoUpstream} onCheckedChange={setDeleteAlsoUpstream} destructive>
                    {t('action.confirm-delete-branch-also-delete-upstream')}
                  </ConfirmCheckbox>
                  <IndentedValue value={branch.tracking!} />
                </div>
              )}
            </div>
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-delete-branch-confirm')}
        destructive
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => {
          const target = deleteConfirm
          const upstream = deleteAlsoUpstream
          setDeleteConfirm(null)
          if (target) void deleteBranch(target, false, upstream)
        }}
      />
      <ConfirmDialog
        open={forceDeleteConfirm !== null}
        title={forceDeleteConfirm ? t('action.confirm-force-delete-standalone-title') : ''}
        message={
          forceDeleteConfirm ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <span>{t('action.confirm-force-delete-standalone-body')}</span>
                <ConfirmValue value={forceDeleteConfirm} />
                <span className="block text-muted-foreground">{t('action.confirm-force-delete-standalone-note')}</span>
              </div>
              {hasUpstream && (
                <div className="space-y-1">
                  <ConfirmCheckbox checked={deleteAlsoUpstream} onCheckedChange={setDeleteAlsoUpstream} destructive>
                    {t('action.confirm-delete-branch-also-delete-upstream')}
                  </ConfirmCheckbox>
                  <IndentedValue value={branch.tracking!} />
                </div>
              )}
            </div>
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-force-delete-standalone-confirm')}
        destructive
        onCancel={() => setForceDeleteConfirm(null)}
        onConfirm={() => {
          const target = forceDeleteConfirm
          const upstream = deleteAlsoUpstream
          setForceDeleteConfirm(null)
          if (target) void deleteBranch(target, true, upstream)
        }}
      />
      <ConfirmDialog
        open={removeConfirm !== null}
        title={removeConfirm ? t('action.confirm-remove-worktree-title') : ''}
        message={
          removeConfirm ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <span>{t('action.confirm-remove-worktree-body')}</span>
                <ConfirmValue value={tildify(removeConfirm.path)} />
              </div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <ConfirmCheckbox
                    checked={removeAlsoDeletes}
                    disabled={removeConfirmProtected}
                    describedBy={removeConfirmProtected ? 'remove-worktree-protected-hint' : undefined}
                    onCheckedChange={setRemoveAlsoDeletes}
                    destructive
                    title={removeConfirmProtected ? t('action.confirm-remove-worktree-protected-hint') : undefined}
                  >
                    {t('action.confirm-remove-worktree-also-delete-branch')}
                  </ConfirmCheckbox>
                  <IndentedValue value={removeConfirm.branch} />
                </div>
                {removeConfirmProtected && (
                  <div id="remove-worktree-protected-hint" className="pl-6 text-xs text-muted-foreground">
                    {t('action.confirm-remove-worktree-protected-hint')}
                  </div>
                )}
                {removeAlsoDeletes && hasUpstream && !removeConfirmProtected && (
                  <div className="space-y-1">
                    <ConfirmCheckbox checked={removeAlsoUpstream} onCheckedChange={setRemoveAlsoUpstream} destructive>
                      {t('action.confirm-delete-branch-also-delete-upstream')}
                    </ConfirmCheckbox>
                    <IndentedValue value={branch.tracking!} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-remove-worktree-confirm')}
        destructive
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={() => {
          const target = removeConfirm
          const alsoDelete = removeAlsoDeletes
          const upstream = removeAlsoUpstream
          setRemoveConfirm(null)
          if (target) void removeWorktree(target, alsoDelete, false, upstream)
        }}
      />
      <ConfirmDialog
        open={forceRemoveConfirm !== null}
        title={forceRemoveConfirm ? t('action.confirm-force-delete-branch-title') : ''}
        message={
          forceRemoveConfirm ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <span>{t('action.confirm-remove-worktree-body')}</span>
                <ConfirmValue value={tildify(forceRemoveConfirm.path)} />
              </div>
              <div className="space-y-1">
                <span>{t('action.confirm-force-delete-branch-body')}</span>
                <ConfirmValue value={forceRemoveConfirm.branch} />
                <span className="block text-muted-foreground">{t('action.confirm-force-delete-branch-note')}</span>
              </div>
              {hasUpstream && (
                <div className="space-y-1">
                  <ConfirmCheckbox checked={removeAlsoUpstream} onCheckedChange={setRemoveAlsoUpstream} destructive>
                    {t('action.confirm-delete-branch-also-delete-upstream')}
                  </ConfirmCheckbox>
                  <IndentedValue value={branch.tracking!} />
                </div>
              )}
            </div>
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirm-force-delete-branch-confirm')}
        destructive
        onCancel={() => setForceRemoveConfirm(null)}
        onConfirm={() => {
          const target = forceRemoveConfirm
          const upstream = removeAlsoUpstream
          setForceRemoveConfirm(null)
          if (target) void removeWorktree(target, true, true, upstream)
        }}
      />
    </>
  )

  return {
    blocked: branchActionBusy || pendingLocalAction !== null,
    busyAction: pendingLocalAction ?? branchBusyAction,
    capabilities,
    actions: {
      copyPatch,
      checkout,
      pull,
      push,
      openTerminal,
      openEditor,
      openRemote,
      requestDeleteBranch,
      requestRemoveWorktree,
    },
    dialogs,
  }
}
