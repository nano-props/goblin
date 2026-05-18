// Per-branch action menu. The same operations that used to live in a
// 5-button toolbar in the repo header — Checkout / Pull / Push / Open
// in Ghostty / Open in GitHub — are all branch-scoped, so they cluster
// far better in a dropdown anchored to each branch row than as a
// standing toolbar driven off the selected branch.
//
// `busy` is local to each menu instance: clicking Pull on branch A
// only dims A's menu, leaving B's responsive. Network ops (pull/push)
// are still cancellable — while one is running the menu shows a
// Cancel item that aborts the underlying git child process. Without
// this a stuck SSH connection would lock the menu for the full
// network timeout (90s).

import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  ExternalLink,
  GitBranch,
  Loader2,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
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
import { formatWorktreeInfo } from '#/renderer/lib/worktree-info.ts'
import type { BranchInfo } from '#/renderer/types.ts'

const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop', 'trunk'])

type Op = 'checkout' | 'pull' | 'push' | 'github' | 'ghostty' | 'deleteBranch' | 'copyWorktreeInfo'
const CANCELLABLE_OPS = new Set<Op>(['pull', 'push'])
const SILENT_SUCCESS_OPS = new Set<Op>(['github', 'ghostty'])
const REFRESH_AFTER_OPS = new Set<Op>(['checkout', 'pull', 'push', 'deleteBranch'])

interface Props {
  repo: RepoState
  branch: BranchInfo
  ghosttyInstalled: boolean
}

export function BranchActionsMenu({ repo, branch, ghosttyInstalled }: Props) {
  const t = useT()
  const refreshSnapshot = useReposStore((s) => s.refreshSnapshot)
  const refreshStatus = useReposStore((s) => s.refreshStatus)
  const setLastResult = useReposStore((s) => s.setLastResult)
  const [busy, setBusy] = useState<Op | null>(null)
  const [pushConfirm, setPushConfirm] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
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
      // Mutating ops change branch state — refresh both snapshot and
      // status. Status drives the always-visible header badge, so we
      // refresh it regardless of which tab is active (otherwise a
      // checkout from the Branches tab leaves the badge count stale).
      if (REFRESH_AFTER_OPS.has(op)) {
        await refreshSnapshot(repo.id)
        await refreshStatus(repo.id)
      }
    } finally {
      setBusy(null)
    }
  }

  function handleCancel() {
    void window.gbl.abort(repo.id).catch(() => {
      /* preload already logs; the in-flight git op will eventually
       * resolve as cancelled even if the abort signal didn't reach it */
    })
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

  function handleCopyWorktreeInfo() {
    if (!branch.worktreePath) return
    setOpen(false)
    void run('copyWorktreeInfo', async () => {
      try {
        await navigator.clipboard.writeText(formatWorktreeInfo(repo, branch))
        return { ok: true, message: 'worktrees.copyInfoOk' }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  const isCurrent = branch.name === repo.currentBranch
  const checkedOutInAnotherWorktree = !!branch.worktreePath && !isCurrent
  const canCopyWorktreeInfo = checkedOutInAnotherWorktree && !branch.worktreeIsPrimary
  const isProtected = PROTECTED_BRANCHES.has(branch.name)
  const isRegularBranch = !isCurrent && !branch.worktreePath && !isProtected
  const cancellable = busy && CANCELLABLE_OPS.has(busy)

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
          {cancellable && (
            <>
              <DropdownMenuItem onClick={handleCancel} variant="destructive">
                <X />
                {t('action.cancel')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
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
            disabled={!branch.tracking || (!!busy && busy !== 'pull')}
            onClick={() => {
              setOpen(false)
              void run('pull', () => window.gbl.pull(repo.id, branch.name, branch.worktreePath))
            }}
          >
            <ArrowDown />
            {t('action.pull')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!!busy && busy !== 'push'} onClick={handlePush}>
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
          {(canCopyWorktreeInfo || isRegularBranch) && (
            <>
              <DropdownMenuSeparator />
              {canCopyWorktreeInfo ? (
                <DropdownMenuItem disabled={!!busy} onClick={handleCopyWorktreeInfo}>
                  <Copy />
                  {t('worktrees.copyInfo')}
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
    </>
  )
}
