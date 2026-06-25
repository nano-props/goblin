// Single-page form for creating a linked worktree. Three modes:
//   - newBranch        : pick a base, type a new branch name.
//   - existingBranch   : pick a local branch; the worktree checks it out.
//   - trackRemoteBranch: pick a remote-tracking branch and (optionally)
//                        override the local branch name it should track.
//
// Errors are surfaced raw from git: path already exists, branch checked
// out elsewhere, missing parent directory, etc. The client gates
// obvious branch / ref name problems up front; anything else stays
// git's responsibility.

import { useEffect, useRef, useState } from 'react'
import { GitBranch, GitBranchPlus, RadioTower, type LucideIcon } from 'lucide-react'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/web/components/ui/select.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/web/components/ui/field.tsx'
import { AnimateHeight } from '#/web/components/ui/animate-height.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { RemotePathSuggestions } from '#/web/components/ui/remote-path-suggestions.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/web/components/ui/toggle-group.tsx'
import { useRemotePathSuggestions } from '#/web/hooks/useRemotePathSuggestions.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { getRepositoryRemoteBranches } from '#/web/repo-client.ts'
import { defaultWorktreePath, formatWorktreePath, tildify, untildify } from '#/web/lib/paths.ts'
import { cn } from '#/web/lib/cn.ts'
import { validateBranchName } from '#/shared/refnames.ts'
import { isResolvableRemotePathInput } from '#/shared/remote-repo.ts'
import { deriveLocalBranchFromRemoteRef, type CreateWorktreeInput } from '#/shared/worktree-create.ts'

type CreateWorktreeDialogMode = CreateWorktreeInput['mode']['kind']

const MODE_OPTIONS = [
  { id: 'newBranch', labelKey: 'action.create-worktree-mode-new', icon: GitBranchPlus },
  { id: 'existingBranch', labelKey: 'action.create-worktree-mode-existing', icon: GitBranch },
  { id: 'trackRemoteBranch', labelKey: 'action.create-worktree-mode-remote', icon: RadioTower },
] satisfies Array<{ id: CreateWorktreeDialogMode; labelKey: string; icon: LucideIcon }>

export interface CreateWorktreeRequest {
  input: CreateWorktreeInput
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

  const [mode, setMode] = useState<CreateWorktreeDialogMode>('newBranch')
  const [base, setBase] = useState<string>('')
  const [branch, setBranch] = useState('')
  const [existingBranch, setExistingBranch] = useState('')
  const [remoteRef, setRemoteRef] = useState('')
  const [localBranch, setLocalBranch] = useState('')
  const [worktreePath, setWorktreePath] = useState('')
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [remoteBranchesLoading, setRemoteBranchesLoading] = useState(false)

  // Reset on the rising edge of `open` only. Listing repo.data.branches /
  // repo.data.currentBranch in the deps would re-fire on every snapshot
  // refresh (incl. background refreshes) and wipe user input.
  const initialBaseRef = useRef('')
  initialBaseRef.current = repo.data.currentBranch || repo.data.branches[0]?.name || ''
  useEffect(() => {
    if (!open) return
    const initialBase = initialBaseRef.current
    setMode('newBranch')
    setBase(initialBase)
    setBranch('')
    setExistingBranch(initialBase)
    setRemoteRef('')
    setLocalBranch('')
    setWorktreePath('')
    setRemoteBranches([])
    setRemoteBranchesLoading(false)
  }, [open])

  // Lazy-load remote-tracking branches the first time the user switches
  // to `trackRemoteBranch`. Re-fetching when `remoteBranches.length > 0`
  // would only matter if the user did a fetch in another tab — leaving
  // it to a future iteration keeps the dialog cheap to open.
  useEffect(() => {
    if (!open || mode !== 'trackRemoteBranch' || remoteBranches.length > 0) return
    const ctrl = new AbortController()
    setRemoteBranchesLoading(true)
    void getRepositoryRemoteBranches(repo.id, ctrl.signal)
      .then((branches) => {
        if (ctrl.signal.aborted) return
        setRemoteBranches(branches)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setRemoteBranches([])
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setRemoteBranchesLoading(false)
      })
    return () => ctrl.abort()
  }, [mode, open, remoteBranches.length, repo.id])

  const remoteTarget = remoteRepoTarget(repo.id, repo.remote.lifecycle)
  const localBranchNames = repo.data.branches.map((b) => b.name)
  const hasLocalBranch = (name: string) => localBranchNames.includes(name)
  const branchWorktree = (name: string) => repo.data.branches.find((b) => b.name === name)?.worktree

  const branchTrimmed = branch.trim()
  const selectedRemoteRef = remoteRef || remoteBranches[0] || ''
  const derivedLocalBranch = deriveLocalBranchFromRemoteRef(selectedRemoteRef) ?? ''
  const trackLocalBranch = localBranch.trim() || derivedLocalBranch
  const pathName = worktreePathName({ mode, branchTrimmed, existingBranch, trackLocalBranch })
  const pathTrimmed = remoteTarget ? worktreePath.trim() : untildify(worktreePath.trim())
  const defaultPath = remoteTarget
    ? defaultRemoteWorktreePath(remoteTarget.remotePath, pathName)
    : defaultWorktreePath(repo.id, pathName)
  const effectivePath = pathTrimmed || defaultPath
  const displayDefaultPath = remoteTarget ? formatWorktreePath(defaultPath, remoteTarget) : tildify(defaultPath)
  const displayEffectivePath = remoteTarget ? formatWorktreePath(effectivePath, remoteTarget) : tildify(effectivePath)
  const pathDisabledHint = t('action.create-worktree-path-disabled-hint')
  const pathHintText = !pathName ? pathDisabledHint : effectivePath ? displayEffectivePath : ''

  const remotePathSuggestions = useRemotePathSuggestions({
    enabled: open && !!remoteTarget && pathName.length > 0,
    alias: remoteTarget?.alias ?? '',
    remotePath: remoteTarget?.remotePath ?? '/',
    prefix: worktreePath,
  })

  const branchValidation = branchTrimmed ? validateBranchName(branchTrimmed) : { ok: true }
  const localBranchValidation = trackLocalBranch ? validateBranchName(trackLocalBranch) : { ok: true }
  const baseExists = base ? hasLocalBranch(base) : false
  const existingBranchExists = existingBranch ? hasLocalBranch(existingBranch) : false
  const branchExists = branchTrimmed ? hasLocalBranch(branchTrimmed) : false
  const trackLocalBranchExists = trackLocalBranch ? hasLocalBranch(trackLocalBranch) : false

  const existingBranchWorktree = existingBranch && existingBranchExists ? branchWorktree(existingBranch) : undefined
  const branchExistingWorktree = branchTrimmed && branchExists ? branchWorktree(branchTrimmed) : undefined
  const trackLocalBranchWorktree =
    trackLocalBranch && trackLocalBranchExists ? branchWorktree(trackLocalBranch) : undefined

  const baseError = mode === 'newBranch' && base && !baseExists ? t('action.create-worktree-base-missing') : ''
  const branchError =
    mode === 'newBranch' && branchTrimmed
      ? !branchValidation.ok
        ? t('action.create-worktree-branch-invalid')
        : branchExists && branchExistingWorktree
          ? t('action.create-worktree-has-worktree', { branch: branchTrimmed })
          : branchExists
            ? t('action.create-worktree-branch-exists')
            : ''
      : ''
  const existingBranchError =
    mode === 'existingBranch' && existingBranch
      ? !existingBranchExists
        ? t('action.create-worktree-existing-missing')
        : existingBranchWorktree
          ? t('action.create-worktree-has-worktree', { branch: existingBranch })
          : ''
      : ''
  const localBranchError =
    mode === 'trackRemoteBranch' && trackLocalBranch
      ? !localBranchValidation.ok
        ? t('action.create-worktree-branch-invalid')
        : trackLocalBranchExists && trackLocalBranchWorktree
          ? t('action.create-worktree-has-worktree', { branch: trackLocalBranch })
          : trackLocalBranchExists
            ? t('action.create-worktree-local-branch-exists')
            : ''
      : ''

  const branchActionBusy = repo.operations.branchAction.phase !== 'idle'
  const validPath = remoteTarget ? isResolvableRemotePathInput(effectivePath) : effectivePath.length > 0
  const input = buildInput()
  const canSubmit = !!input && validPath && !branchActionBusy

  function buildInput(): CreateWorktreeInput | null {
    if (!validPath) return null
    switch (mode) {
      case 'newBranch':
        return branchTrimmed && !branchError && baseExists
          ? { worktreePath: effectivePath, mode: { kind: 'newBranch', newBranch: branchTrimmed, baseRef: base } }
          : null
      case 'existingBranch':
        return existingBranch && existingBranchExists && !existingBranchError
          ? { worktreePath: effectivePath, mode: { kind: 'existingBranch', branch: existingBranch } }
          : null
      case 'trackRemoteBranch':
        return selectedRemoteRef && trackLocalBranch && !localBranchError
          ? {
              worktreePath: effectivePath,
              mode: { kind: 'trackRemoteBranch', remoteRef: selectedRemoteRef, localBranch: trackLocalBranch },
            }
          : null
    }
    const exhaustive: never = mode
    return exhaustive
  }

  function handleSubmit() {
    const nextInput = buildInput()
    if (!nextInput || branchActionBusy) return
    void onCreate({ input: nextInput })
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
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
      >
        <Field className="gap-2">
          <FieldLabel>{t('action.create-worktree-mode-label')}</FieldLabel>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(next) => {
              if (next) setMode(next as CreateWorktreeDialogMode)
            }}
            variant="outline"
            size="sm"
            className="w-full"
            aria-label={t('action.create-worktree-mode-label')}
          >
            {MODE_OPTIONS.map((option) => {
              const Icon = option.icon
              const selected = mode === option.id
              return (
                <ToggleGroupItem
                  key={option.id}
                  value={option.id}
                  className={cn(
                    'flex min-h-8 flex-1 items-center justify-center gap-1 px-2 text-xs',
                    selected && 'bg-selected text-selected-foreground',
                  )}
                >
                  <Icon size={14} />
                  <span className="truncate">{t(option.labelKey)}</span>
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </Field>

        <AnimateHeight>
          <div className="space-y-3">
            {mode === 'newBranch' && (
              <>
                <Field className="gap-2" data-invalid={baseError ? true : undefined}>
                  <FieldLabel htmlFor="cwt-base">{t('action.create-worktree-base-label')}</FieldLabel>
                  <Select value={base} onValueChange={setBase}>
                    <SelectTrigger
                      id="cwt-base"
                      className="h-10 w-full text-sm"
                      aria-invalid={!!baseError}
                      aria-describedby="cwt-base-error"
                    >
                      <SelectValue placeholder={t('action.create-worktree-base-placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {repo.data.branches.map((b) => (
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

                <Field className="gap-2" data-invalid={branchError ? true : undefined}>
                  <FieldLabel htmlFor="cwt-branch">{t('action.create-worktree-branch-label')}</FieldLabel>
                  <Input
                    id="cwt-branch"
                    autoFocus
                    className="h-10 text-sm"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder={t('action.create-worktree-branch-placeholder')}
                    aria-invalid={!!branchError}
                    aria-describedby="cwt-branch-error"
                  />
                  <FieldError id="cwt-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
                    {branchError}
                  </FieldError>
                </Field>
              </>
            )}

            {mode === 'existingBranch' && (
              <Field className="gap-2" data-invalid={existingBranchError ? true : undefined}>
                <FieldLabel htmlFor="cwt-existing-branch">{t('action.create-worktree-existing-label')}</FieldLabel>
                <Select value={existingBranch} onValueChange={setExistingBranch}>
                  <SelectTrigger
                    id="cwt-existing-branch"
                    className="h-10 w-full text-sm"
                    aria-invalid={!!existingBranchError}
                    aria-describedby="cwt-existing-branch-error"
                  >
                    <SelectValue placeholder={t('action.create-worktree-existing-placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {repo.data.branches.map((b) => (
                      <SelectItem key={b.name} value={b.name} textValue={b.name}>
                        <span className="truncate">{b.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="cwt-existing-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
                  {existingBranchError}
                </FieldError>
              </Field>
            )}

            {mode === 'trackRemoteBranch' && (
              <>
                <Field className="gap-2">
                  <FieldLabel htmlFor="cwt-remote-ref">{t('action.create-worktree-remote-label')}</FieldLabel>
                  <Select
                    value={selectedRemoteRef}
                    onValueChange={(next) => {
                      setRemoteRef(next)
                      setLocalBranch('')
                    }}
                    disabled={remoteBranches.length === 0}
                  >
                    <SelectTrigger id="cwt-remote-ref" className="h-10 w-full text-sm">
                      <SelectValue placeholder={t('action.create-worktree-remote-placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {remoteBranches.map((ref) => (
                        <SelectItem key={ref} value={ref} textValue={ref}>
                          <span className="truncate">{ref}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription reserveHeight aria-live="polite" aria-atomic="true">
                    {remoteBranchesLoading
                      ? t('action.create-worktree-remote-loading')
                      : remoteBranches.length === 0
                        ? t('action.create-worktree-remote-empty')
                        : ''}
                  </FieldDescription>
                </Field>

                <Field className="gap-2" data-invalid={localBranchError ? true : undefined}>
                  <FieldLabel htmlFor="cwt-local-branch">{t('action.create-worktree-local-branch-label')}</FieldLabel>
                  <Input
                    id="cwt-local-branch"
                    className="h-10 text-sm"
                    value={localBranch}
                    onChange={(e) => setLocalBranch(e.target.value)}
                    placeholder={derivedLocalBranch || t('action.create-worktree-local-branch-placeholder')}
                    aria-invalid={!!localBranchError}
                    aria-describedby="cwt-local-branch-error"
                  />
                  <FieldError id="cwt-local-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
                    {localBranchError}
                  </FieldError>
                </Field>
              </>
            )}
          </div>
        </AnimateHeight>

        <Field className="gap-2">
          <FieldLabel htmlFor="cwt-path">{t('action.create-worktree-path-label')}</FieldLabel>
          {remoteTarget ? (
            <RemotePathSuggestions
              id="cwt-path"
              value={worktreePath}
              disabled={!pathName}
              onChange={setWorktreePath}
              suggestions={remotePathSuggestions.suggestions}
              isLoading={remotePathSuggestions.isLoading}
              hasFetched={remotePathSuggestions.hasFetched}
              emptyLabel={t('repo-picker.open-remote-path-no-matches')}
              placeholder={displayDefaultPath}
              aria-describedby="cwt-path-hint"
            />
          ) : (
            <Input
              id="cwt-path"
              value={worktreePath}
              disabled={!pathName}
              onChange={(e) => setWorktreePath(e.target.value)}
              placeholder={displayDefaultPath}
              aria-describedby="cwt-path-hint"
              className="h-10 font-mono text-sm"
            />
          )}
          <FieldDescription
            id="cwt-path-hint"
            reserveHeight
            className="truncate"
            title={displayEffectivePath || undefined}
          >
            {pathHintText}
          </FieldDescription>
        </Field>
        <DialogFooter className="gap-2 pt-2">
          <Button type="button" variant="outline" className={cn(compact && 'w-full')} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button type="submit" className={cn('min-w-28', compact && 'w-full min-w-0')} disabled={!canSubmit}>
            {t('action.create-worktree-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

function worktreePathName(input: {
  mode: CreateWorktreeDialogMode
  branchTrimmed: string
  existingBranch: string
  trackLocalBranch: string
}): string {
  switch (input.mode) {
    case 'newBranch':
      return input.branchTrimmed
    case 'existingBranch':
      return input.existingBranch
    case 'trackRemoteBranch':
      return input.trackLocalBranch
  }
  const exhaustive: never = input.mode
  return exhaustive
}

function defaultRemoteWorktreePath(repoPath: string, name: string): string {
  const slug = name.trim().replaceAll('/', '-')
  if (!slug) return ''
  const normalized = repoPath.replace(/\/+$/, '')
  const baseName = normalized.split('/').filter(Boolean).at(-1) ?? 'worktree'
  const parent = normalized.slice(0, Math.max(0, normalized.lastIndexOf('/'))) || '/'
  return `${parent === '/' ? '' : parent}/${baseName}-${slug}`
}
