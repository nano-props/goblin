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
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/web/components/ui/select.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/web/components/ui/field.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { useRemotePathSuggestions } from '#/web/hooks/useRemotePathSuggestions.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { defaultWorktreePath, formatWorktreePath, tildify, untildify } from '#/web/lib/paths.ts'
import { cn } from '#/web/lib/cn.ts'
import { validateBranchName } from '#/shared/refnames.ts'
import { isResolvableRemotePathInput } from '#/shared/remote-repo.ts'

export interface CreateWorktreeRequest {
  worktreePath: string
  newBranch: string
  baseBranch: string
}

interface Props {
  open: boolean
  repo: RepoState
  onClose: () => void
  onCreate: (request: CreateWorktreeRequest) => void | Promise<void>
}

export function CreateWorktreeDialog({ open, repo, onClose, onCreate }: Props) {
  const t = useT()
  const compact = useIsCompactUi()

  const [base, setBase] = useState<string>('')
  const [branch, setBranch] = useState('')
  const [worktreePath, setWorktreePath] = useState('')

  // Reset on the rising edge of `open` only. Listing repo.data.branches /
  // repo.data.currentBranch in the deps would re-fire on every snapshot
  // refresh (incl. background refreshes) and wipe user input.
  // Snapshot the initial base via a ref so the open-edge handler
  // reads the current value without taking a dep on it.
  const initialBaseRef = useRef('')
  initialBaseRef.current = repo.data.currentBranch || repo.data.branches[0]?.name || ''
  useEffect(() => {
    if (!open) return
    setBase(initialBaseRef.current)
    setBranch('')
    setWorktreePath('')
  }, [open])

  const branchTrimmed = branch.trim()
  const remoteTarget = repo.remote.target
  const pathTrimmed = remoteTarget ? worktreePath.trim() : untildify(worktreePath.trim())
  const defaultPath = remoteTarget
    ? defaultRemoteWorktreePath(remoteTarget.remotePath, branchTrimmed)
    : defaultWorktreePath(repo.id, branchTrimmed)
  const branchValidation = branchTrimmed ? validateBranchName(branchTrimmed) : { ok: true }
  const baseExists = base ? repo.data.branches.some((b) => b.name === base) : false
  const baseError = base && !baseExists ? t('action.create-worktree-base-missing') : ''
  const branchExists = branchTrimmed ? repo.data.branches.some((b) => b.name === branchTrimmed) : false
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
  const displayDefaultPath = remoteTarget ? formatWorktreePath(defaultPath, remoteTarget) : tildify(defaultPath)
  const displayEffectivePath = remoteTarget ? formatWorktreePath(effectivePath, remoteTarget) : tildify(effectivePath)
  const pathSuggestions = useRemotePathSuggestions({
    enabled: open && !!remoteTarget && branchTrimmed.length > 0,
    alias: remoteTarget?.alias ?? '',
    remotePath: remoteTarget?.remotePath ?? '/',
    prefix: worktreePath,
  })
  const branchActionBusy = repo.operations.branchAction.phase !== 'idle'
  const validPath = remoteTarget ? isResolvableRemotePathInput(effectivePath) : effectivePath.length > 0
  const canSubmit = branchTrimmed.length > 0 && !branchError && validPath && baseExists

  function handleSubmit() {
    if (!canSubmit || branchActionBusy) return
    void onCreate({ worktreePath: effectivePath, newBranch: branchTrimmed, baseBranch: base })
    onClose()
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={t('action.create-worktree-title')}
      description={t('action.create-worktree-hint')}
    >
      <form
        className="space-y-0"
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
      >
        <Field data-invalid={baseError ? true : undefined}>
          <FieldLabel htmlFor="cwt-base">{t('action.create-worktree-base-label')}</FieldLabel>
          <Select value={base} onValueChange={setBase}>
            <SelectTrigger
              id="cwt-base"
              className="w-full"
              aria-invalid={!!baseError}
              aria-describedby={baseError ? 'cwt-base-error' : undefined}
            >
              <SelectValue placeholder={t('action.create-worktree-base-placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {repo.data.branches.map((b) => (
                // textValue is the typeahead string (also what Radix
                // echoes into the trigger via SelectValue). We pass
                // just the branch name so the trigger shows "main"
                // instead of "main current" once selected.
                <SelectItem key={b.name} value={b.name} textValue={b.name}>
                  <span className="truncate">{b.name}</span>
                  {b.name === repo.data.currentBranch && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('action.create-worktree-base-current')}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id="cwt-base-error" reserveHeight aria-live="polite" aria-atomic="true">
            {baseError}
          </FieldError>
        </Field>

        <Field data-invalid={branchError ? true : undefined}>
          <FieldLabel htmlFor="cwt-branch">{t('action.create-worktree-branch-label')}</FieldLabel>
          <Input
            id="cwt-branch"
            autoFocus
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder={t('action.create-worktree-branch-placeholder')}
            aria-invalid={!!branchError}
            aria-describedby={branchError ? 'cwt-branch-error' : undefined}
          />
          <FieldError id="cwt-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
            {branchError}
          </FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="cwt-path">{t('action.create-worktree-path-label')}</FieldLabel>
          <Input
            id="cwt-path"
            value={worktreePath}
            disabled={!branchTrimmed}
            onChange={(e) => setWorktreePath(e.target.value)}
            placeholder={displayDefaultPath}
            aria-describedby="cwt-path-hint"
            className="font-mono text-xs"
            list={pathSuggestions.length > 0 ? 'create-worktree-path-suggestions' : undefined}
          />
          {pathSuggestions.length > 0 && (
            <datalist id="create-worktree-path-suggestions">
              {pathSuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          )}
          <FieldDescription
            id="cwt-path-hint"
            reserveHeight
            className="truncate"
            title={displayEffectivePath || undefined}
          >
            {!branchTrimmed
              ? t('action.create-worktree-path-disabled-hint')
              : effectivePath
                ? displayEffectivePath
                : ''}
          </FieldDescription>
        </Field>
        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" className={cn(compact && 'w-full')} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" className={cn(compact && 'w-full')} disabled={!canSubmit || branchActionBusy}>
            {t('action.create-worktree-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

function defaultRemoteWorktreePath(repoPath: string, branch: string): string {
  const slug = branch.trim().replaceAll('/', '-')
  if (!slug) return ''
  const normalized = repoPath.replace(/\/+$/, '')
  const baseName = normalized.split('/').filter(Boolean).at(-1) ?? 'worktree'
  const parent = normalized.slice(0, Math.max(0, normalized.lastIndexOf('/'))) || '/'
  return `${parent === '/' ? '' : parent}/${baseName}-${slug}`
}
