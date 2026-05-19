// Per-branch action menu. The same operations that used to live in a
// 5-button toolbar in the repo header — Checkout / Pull / Push / Open
// in Ghostty / Open in GitHub — are all branch-scoped, so they cluster
// far better in a dropdown anchored to each branch row than as a
// standing toolbar driven off the selected branch.
//
// `busy` is local to each menu instance: clicking Pull on branch A
// only dims A's menu, leaving B's responsive. Network ops (pull/push)
// rely on the git helper timeout for stuck remotes; failures surface via
// the same result toast as normal git errors.

import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, GitBranch, Loader2, Terminal, Trash2 } from 'lucide-react'
import { useReposStore, type RepoState } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { ConfirmDialog } from '#/renderer/components/ConfirmDialog.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/renderer/components/ui/dropdown-menu.tsx'
import { tildify } from '#/renderer/lib/paths.ts'
import type { BranchInfo } from '#/renderer/types.ts'
import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'

type Op = 'checkout' | 'pull' | 'push' | 'github' | 'ghostty' | 'deleteBranch' | 'removeWorktree'
const NETWORK_OPS = new Set<Op>(['pull', 'push'])
const SILENT_SUCCESS_OPS = new Set<Op>(['github', 'ghostty'])
const REFRESH_AFTER_OPS = new Set<Op>(['checkout', 'pull', 'push', 'deleteBranch', 'removeWorktree'])

interface Props {
  repo: RepoState
  branch: BranchInfo
  ghosttyInstalled: boolean
}

export function BranchActionsMenu({ repo, branch, ghosttyInstalled }: Props) {
  const t = useT()
  const refreshSnapshot = useReposStore((s) => s.refreshSnapshot)
  const refreshStatus = useReposStore((s) => s.refreshStatus)
  const clearFetchFailed = useReposStore((s) => s.clearFetchFailed)
  const setLastResult = useReposStore((s) => s.setLastResult)
  const [busy, setBusy] = useState<Op | null>(null)
  const [pushConfirm, setPushConfirm] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null)
  // Also-delete-branch toggle for the remove-worktree dialog. Default
  // on: the common flow is "I'm done with this branch and its
  // worktree, clean both up." Re-defaulted to true every time the
  // dialog opens so an earlier untick doesn't bleed into a fresh op.
  const [removeAlsoDeletes, setRemoveAlsoDeletes] = useState(true)
  const [open, setOpen] = useState(false)

  async function run(op: Op, fn: () => Promise<{ ok: boolean; message: string }>) {
    if (busy) return
    setBusy(op)
    try {
      const result = await fn()
      if (!result.ok && result.message === 'cancelled') return
      // openGitHub / openInGhostty success is silent: the user is
      // already looking at the freshly-opened browser tab / terminal.
      // A "GitHub: OK" toast on top of that is noise. Failures still
      // surface (no origin remote, ghostty crashed) because the user
      // might miss the lack of a tab/window.
      const skipSuccessToast = result.ok && SILENT_SUCCESS_OPS.has(op)
      if (!skipSuccessToast) setLastResult(repo.id, result)
      if (!result.ok && result.message === 'error.networkOpInProgress') return
      // Mutating ops change branch state — refresh both snapshot and
      // status. Status drives the always-visible header badge, so we
      // refresh it regardless of which tab is active (otherwise a
      // checkout from the Branches tab leaves the badge count stale).
      if (REFRESH_AFTER_OPS.has(op)) {
        await refreshSnapshot(repo.id)
        await refreshStatus(repo.id)
      }
      if (result.ok && NETWORK_OPS.has(op)) clearFetchFailed(repo.id)
    } finally {
      setBusy(null)
    }
  }

  function handlePush() {
    if (PROTECTED_BRANCHES.has(branch.name)) {
      setPushConfirm(branch.name)
      setOpen(false)
      return
    }
    setOpen(false)
    void run('push', () => window.gbl.push(repo.id, branch.name))
  }

  function handleDeleteBranch() {
    setDeleteConfirm(branch.name)
    setOpen(false)
  }

  function handleRemoveWorktree() {
    if (!branch.worktreePath) return
    // Protected branches (main/master/etc.) can never be deleted, so
    // the default "also delete branch" tick would only get the user a
    // toast asking them to come back and untick it. Default off there.
    setRemoveAlsoDeletes(!PROTECTED_BRANCHES.has(branch.name))
    setRemoveConfirm(branch.worktreePath)
    setOpen(false)
  }

  const isCurrent = branch.name === repo.currentBranch
  const checkedOutInAnotherWorktree = !!branch.worktreePath && !isCurrent
  const canRemoveWorktree = checkedOutInAnotherWorktree && !branch.worktreeIsPrimary
  const isProtected = PROTECTED_BRANCHES.has(branch.name)
  const isRegularBranch = !isCurrent && !branch.worktreePath && !isProtected

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            // Plain ghost — same hover behaviour as the Refresh/Fetch
            // buttons in the repo header. The only extra is the
            // data-[state=open] tint so the user knows the menu is
            // attached to *this* button while it's open.
            className="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
            // Stop bubbling so the row's onClick (branch select) doesn't
            // fire when the user opens the menu.
            onClick={(e) => e.stopPropagation()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <ChevronDown />}
            {t('action.menu')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Stop bubbling so the row's onClick (which selects the branch)
          // doesn't fire when the user clicks an item inside the menu.
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem
            disabled={isCurrent || checkedOutInAnotherWorktree || !!busy}
            onClick={() => {
              setOpen(false)
              void run('checkout', () => window.gbl.checkout(repo.id, branch.name))
            }}
          >
            <GitBranch />
            {t('action.checkout')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!branch.tracking || !!busy}
            onClick={() => {
              setOpen(false)
              void run('pull', () => window.gbl.pull(repo.id, branch.name, branch.worktreePath))
            }}
          >
            <ArrowDown />
            {t('action.pull')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!!busy} onClick={handlePush}>
            <ArrowUp />
            {t('action.push')}
          </DropdownMenuItem>
          {branch.worktreePath && ghosttyInstalled && (
            <DropdownMenuItem
              disabled={!!busy}
              onClick={() => {
                setOpen(false)
                void run('ghostty', () => window.gbl.openInGhostty(branch.worktreePath!))
              }}
            >
              <Terminal />
              {t('worktrees.openInGhosttyLabel')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={!!busy}
            onClick={() => {
              setOpen(false)
              void run('github', () => window.gbl.openGitHub(repo.id, branch.name))
            }}
          >
            <ExternalLink />
            {t('action.github')}
          </DropdownMenuItem>
          {(canRemoveWorktree || isRegularBranch) && (
            <>
              <DropdownMenuSeparator />
              {canRemoveWorktree ? (
                <DropdownMenuItem disabled={!!busy} onClick={handleRemoveWorktree} variant="destructive">
                  <Trash2 />
                  {t('action.removeWorktree')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled={!!busy} onClick={handleDeleteBranch} variant="destructive">
                  <Trash2 />
                  {t('action.deleteBranch')}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
        title={t('action.confirmRemoveWorktreeTitle', { branch: branch.name })}
        message={
          removeConfirm ? (
            <div className="space-y-3">
              <span>
                {t('action.confirmRemoveWorktreeBody.before')}
                <b className="text-foreground">{tildify(removeConfirm)}</b>
                {t('action.confirmRemoveWorktreeBody.after')}
              </span>
              <label
                className={
                  PROTECTED_BRANCHES.has(branch.name)
                    ? 'flex items-center gap-2 text-muted-foreground select-none cursor-not-allowed'
                    : 'flex items-center gap-2 text-foreground cursor-pointer select-none'
                }
                title={PROTECTED_BRANCHES.has(branch.name) ? t('action.confirmRemoveWorktreeProtectedHint') : undefined}
              >
                <input
                  type="checkbox"
                  checked={removeAlsoDeletes}
                  disabled={PROTECTED_BRANCHES.has(branch.name)}
                  onChange={(e) => setRemoveAlsoDeletes(e.target.checked)}
                  className="h-4 w-4 accent-destructive disabled:opacity-50"
                />
                <span>{t('action.confirmRemoveWorktreeAlsoDeleteBranch', { branch: branch.name })}</span>
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
            void run('removeWorktree', () => window.gbl.removeWorktree(repo.id, branch.name, target, alsoDelete))
        }}
      />
    </>
  )
}
