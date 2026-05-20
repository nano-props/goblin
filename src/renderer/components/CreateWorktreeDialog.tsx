// Single-page form for creating a linked worktree:
//   - Pick base branch via Select dropdown (defaults to current branch).
//   - Type new branch name.
//   - Optionally type a worktree path; left blank, we use a sibling
//     default `<repo-parent>/<repo-name>-<branch>`. The path field is
//     disabled until a branch name exists, since the auto-derived
//     suggestion only makes sense once we have a slug to plug in.
//
// Errors are surfaced raw from git: path already exists, missing
// parent directory, etc. The renderer's input gating handles branch
// names up front; anything else is git's responsibility and its errors
// are precise enough to show as-is.

import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/renderer/components/ui/dialog.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/renderer/components/ui/select.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import type { RepoState } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { defaultWorktreePath, tildify, untildify } from '#/renderer/lib/paths.ts'
import { validateBranchName } from '#/shared/refnames.ts'

export interface CreateWorktreeRequest {
  worktreePath: string
  newBranch: string
  baseBranch: string
}

interface Props {
  open: boolean
  repo: RepoState
  onClose: () => void
  onCreate: (request: CreateWorktreeRequest) => void
}

export function CreateWorktreeDialog({ open, repo, onClose, onCreate }: Props) {
  const t = useT()

  const [base, setBase] = useState<string>('')
  const [branch, setBranch] = useState('')
  const [worktreePath, setWorktreePath] = useState('')

  // Reset on the rising edge of `open` only. Listing repo.branches /
  // repo.currentBranch in the deps would re-fire on every snapshot
  // refresh (incl. silent background fetch) and wipe user input.
  // Snapshot the initial base via a ref so the open-edge handler
  // reads the current value without taking a dep on it.
  const initialBaseRef = useRef('')
  initialBaseRef.current = repo.currentBranch || repo.branches[0]?.name || ''
  useEffect(() => {
    if (!open) return
    setBase(initialBaseRef.current)
    setBranch('')
    setWorktreePath('')
  }, [open])

  const branchTrimmed = branch.trim()
  const pathTrimmed = untildify(worktreePath.trim())
  const defaultPath = defaultWorktreePath(repo.id, branchTrimmed)
  const branchValidation = branchTrimmed ? validateBranchName(branchTrimmed) : { ok: true }
  const branchExists = branchTrimmed ? repo.branches.some((b) => b.name === branchTrimmed) : false
  const branchError = branchTrimmed
    ? !branchValidation.ok
      ? t('action.create-worktree-branch-invalid')
      : branchExists
        ? t('action.create-worktree-branch-exists')
        : ''
    : ''
  // Effective path that will be sent on submit: user's typed value if
  // provided, else the auto-derived sibling default. Shown as a
  // greyed-out preview so users know what they'll get without typing.
  const effectivePath = pathTrimmed || defaultPath
  const displayDefaultPath = tildify(defaultPath)
  const displayEffectivePath = tildify(effectivePath)
  const canSubmit = branchTrimmed.length > 0 && !branchError && effectivePath.length > 0 && base.length > 0

  function handleSubmit() {
    if (!canSubmit) return
    onClose()
    onCreate({ worktreePath: effectivePath, newBranch: branchTrimmed, baseBranch: base })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('action.create-worktree-title')}</DialogTitle>
          <DialogDescription>{t('action.create-worktree-hint')}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <div>
            <label className="block text-sm font-medium text-foreground" htmlFor="cwt-base">
              {t('action.create-worktree-base-label')}
            </label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger id="cwt-base" className="mt-1 w-full">
                <SelectValue placeholder={t('action.create-worktree-base-placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {repo.branches.map((b) => (
                  // textValue is the typeahead string (also what Radix
                  // echoes into the trigger via SelectValue). We pass
                  // just the branch name so the trigger shows "main"
                  // instead of "main current" once selected.
                  <SelectItem key={b.name} value={b.name} textValue={b.name}>
                    <span className="truncate">{b.name}</span>
                    {b.name === repo.currentBranch && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('action.create-worktree-base-current')}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground" htmlFor="cwt-branch">
              {t('action.create-worktree-branch-label')}
            </label>
            <input
              id="cwt-branch"
              autoFocus
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder={t('action.create-worktree-branch-placeholder')}
              aria-invalid={!!branchError}
              aria-describedby={branchError ? 'cwt-branch-error' : undefined}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring aria-invalid:border-destructive aria-invalid:ring-destructive/20"
            />
            {branchError && (
              <div id="cwt-branch-error" className="mt-1 text-xs text-destructive">
                {branchError}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground" htmlFor="cwt-path">
              {t('action.create-worktree-path-label')}
            </label>
            <input
              id="cwt-path"
              value={worktreePath}
              disabled={!branchTrimmed}
              onChange={(e) => setWorktreePath(e.target.value)}
              placeholder={displayDefaultPath}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div className="mt-1 text-xs text-muted-foreground truncate" title={displayEffectivePath || undefined}>
              {!branchTrimmed
                ? t('action.create-worktree-path-disabled-hint')
                : effectivePath
                  ? displayEffectivePath
                  : ''}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('dialog.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t('action.create-worktree-confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
