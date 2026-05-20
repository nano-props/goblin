import { useRef, useState } from 'react'
import { useReposStore, type RepoState } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { ConfirmDialog } from '#/renderer/components/ConfirmDialog.tsx'
import { tildify } from '#/renderer/lib/paths.ts'
import type { BranchInfo, ExecResult } from '#/renderer/types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'

export type BranchActionOp =
  | 'copyPatch'
  | 'checkout'
  | 'pull'
  | 'push'
  | 'github'
  | 'ghostty'
  | 'vscode'
  | 'deleteBranch'
  | 'removeWorktree'

const NETWORK_OPS = new Set<BranchActionOp>(['pull', 'push'])
const SILENT_SUCCESS_OPS = new Set<BranchActionOp>(['github', 'ghostty', 'vscode'])
const REFRESH_AFTER_OPS = new Set<BranchActionOp>(['checkout', 'pull', 'push', 'deleteBranch', 'removeWorktree'])

interface RemoveConfirm {
  branch: string
  path: string
}

export function useBranchActions(repo: RepoState, branch: BranchInfo) {
  const t = useT()
  const refreshSnapshot = useReposStore((s) => s.refreshSnapshot)
  const refreshStatus = useReposStore((s) => s.refreshStatus)
  const clearFetchFailed = useReposStore((s) => s.clearFetchFailed)
  const setLastResult = useReposStore((s) => s.setLastResult)
  const busyRef = useRef<BranchActionOp | null>(null)
  const [busy, setBusy] = useState<BranchActionOp | null>(null)
  const [pushConfirm, setPushConfirm] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<RemoveConfirm | null>(null)
  const [removeAlsoDeletes, setRemoveAlsoDeletes] = useState(true)

  async function run(op: BranchActionOp, fn: () => Promise<ExecResult>) {
    if (busyRef.current) return
    busyRef.current = op
    setBusy(op)
    const token = repo.instanceToken
    try {
      const result = await fn()
      if (!result.ok && result.message === 'cancelled') return
      const skipSuccessToast = result.ok && SILENT_SUCCESS_OPS.has(op)
      if (!skipSuccessToast) setLastResult(repo.id, result, token)
      if (!result.ok && result.message === 'error.networkOpInProgress') return
      if (REFRESH_AFTER_OPS.has(op)) {
        await refreshSnapshot(repo.id, { token })
        await refreshStatus(repo.id, { token })
      }
      if (result.ok && NETWORK_OPS.has(op)) clearFetchFailed(repo.id, token)
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }

  function copyPatch() {
    if (!branch.worktreePath) return
    const worktreePath = branch.worktreePath
    void run('copyPatch', async () => {
      const result = await window.gbl.patch(repo.id, worktreePath)
      if (!result.ok) return { ok: false, message: result.message }
      if (!result.message) return { ok: false, message: 'status.copyPatchEmpty' }
      try {
        await navigator.clipboard.writeText(result.message)
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
      return { ok: true, message: 'status.copyPatchOk' }
    })
  }

  function checkout() {
    void run('checkout', () => window.gbl.checkout(repo.id, branch.name))
  }

  function pull() {
    void run('pull', () => window.gbl.pull(repo.id, branch.name, branch.worktreePath))
  }

  function push() {
    if (busyRef.current) return
    if (PROTECTED_BRANCHES.has(branch.name)) {
      setPushConfirm(branch.name)
      return
    }
    void run('push', () => window.gbl.push(repo.id, branch.name))
  }

  function openGhostty() {
    if (!branch.worktreePath) return
    const worktreePath = branch.worktreePath
    void run('ghostty', () => window.gbl.openInGhostty(worktreePath))
  }

  function openVSCode() {
    if (!branch.worktreePath) return
    const worktreePath = branch.worktreePath
    void run('vscode', () => window.gbl.openInVSCode(worktreePath))
  }

  function openGitHub() {
    void run('github', () => window.gbl.openGitHub(repo.id, branch.name))
  }

  function requestDeleteBranch() {
    if (busyRef.current) return
    setDeleteConfirm(branch.name)
  }

  function requestRemoveWorktree() {
    if (busyRef.current || !branch.worktreePath) return
    setRemoveAlsoDeletes(!PROTECTED_BRANCHES.has(branch.name))
    setRemoveConfirm({ branch: branch.name, path: branch.worktreePath })
  }

  const isCurrent = branch.name === repo.currentBranch
  const checkedOutInAnotherWorktree = !!branch.worktreePath && !isCurrent
  const canRemoveWorktree = checkedOutInAnotherWorktree && !branch.worktreeIsPrimary
  const isProtected = PROTECTED_BRANCHES.has(branch.name)
  const isRegularBranch = !isCurrent && !branch.worktreePath && !isProtected
  const changedStatus = branch.worktreePath ? repo.status.find((wt) => wt.path === branch.worktreePath) : null
  const canCopyPatch = !!branch.worktreePath && (changedStatus?.entries.length ?? 0) > 0

  const dialogs = (
    <>
      <ConfirmDialog
        open={pushConfirm !== null}
        title={pushConfirm ? t('action.confirmPushProtectedTitle', { branch: pushConfirm }) : ''}
        message={
          pushConfirm ? (
            <span>
              {t('action.confirmPushProtectedBody.before')}
              <b className="text-foreground">{pushConfirm}</b>
              {t('action.confirmPushProtectedBody.after')}
            </span>
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirmPushConfirm')}
        destructive
        onCancel={() => setPushConfirm(null)}
        onConfirm={() => {
          const target = pushConfirm
          setPushConfirm(null)
          if (target) void run('push', () => window.gbl.push(repo.id, target))
        }}
      />
      <ConfirmDialog
        open={deleteConfirm !== null}
        title={deleteConfirm ? t('action.confirmDeleteBranchTitle', { branch: deleteConfirm }) : ''}
        message={
          deleteConfirm ? (
            <span>
              {t('action.confirmDeleteBranchBody.before')}
              <b className="text-foreground">{deleteConfirm}</b>
              {t('action.confirmDeleteBranchBody.after')}
            </span>
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirmDeleteBranchConfirm')}
        destructive
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => {
          const target = deleteConfirm
          setDeleteConfirm(null)
          if (target) void run('deleteBranch', () => window.gbl.deleteBranch(repo.id, target))
        }}
      />
      <ConfirmDialog
        open={removeConfirm !== null}
        title={removeConfirm ? t('action.confirmRemoveWorktreeTitle', { branch: removeConfirm.branch }) : ''}
        message={
          removeConfirm ? (
            <div className="space-y-3">
              <span>
                {t('action.confirmRemoveWorktreeBody.before')}
                <b className="text-foreground">{tildify(removeConfirm.path)}</b>
                {t('action.confirmRemoveWorktreeBody.after')}
              </span>
              <label
                className={
                  PROTECTED_BRANCHES.has(removeConfirm.branch)
                    ? 'flex items-center gap-2 text-muted-foreground select-none cursor-not-allowed'
                    : 'flex items-center gap-2 text-foreground cursor-pointer select-none'
                }
                title={
                  PROTECTED_BRANCHES.has(removeConfirm.branch)
                    ? t('action.confirmRemoveWorktreeProtectedHint')
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={removeAlsoDeletes}
                  disabled={PROTECTED_BRANCHES.has(removeConfirm.branch)}
                  onChange={(e) => setRemoveAlsoDeletes(e.target.checked)}
                  className="h-4 w-4 accent-destructive disabled:opacity-50"
                />
                <span>{t('action.confirmRemoveWorktreeAlsoDeleteBranch', { branch: removeConfirm.branch })}</span>
              </label>
            </div>
          ) : (
            ''
          )
        }
        confirmLabel={t('action.confirmRemoveWorktreeConfirm')}
        destructive
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={() => {
          const target = removeConfirm
          const alsoDelete = removeAlsoDeletes
          setRemoveConfirm(null)
          if (target)
            void run('removeWorktree', () => window.gbl.removeWorktree(repo.id, target.branch, target.path, alsoDelete))
        }}
      />
    </>
  )

  return {
    busy,
    capabilities: {
      isCurrent,
      checkedOutInAnotherWorktree,
      canRemoveWorktree,
      isRegularBranch,
      canCopyPatch,
      canPull: !!branch.tracking,
      canOpenGhostty: !!branch.worktreePath,
      canOpenVSCode: !!branch.worktreePath,
    },
    actions: {
      copyPatch,
      checkout,
      pull,
      push,
      openGhostty,
      openVSCode,
      openGitHub,
      requestDeleteBranch,
      requestRemoveWorktree,
    },
    dialogs,
  }
}
