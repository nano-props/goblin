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
import { GitBranch, GitBranchPlus, RadioTower, ShieldCheck, type LucideIcon } from 'lucide-react'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/web/components/ui/select.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/web/components/ui/field.tsx'
import { AnimateHeight } from '#/web/components/ui/animate-height.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { RemotePathSuggestions } from '#/web/components/ui/remote-path-suggestions.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/web/components/ui/toggle-group.tsx'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'
import { useRemotePathSuggestions } from '#/web/hooks/useRemotePathSuggestions.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { remoteRepoTarget } from '#/web/stores/repos/helpers.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { getRepositoryRemoteBranches } from '#/web/repo-client.ts'
import { cn } from '#/web/lib/cn.ts'
import {
  deriveCreateWorktreeForm,
  type CreateWorktreeDialogMode,
  type CreateWorktreeRequest,
} from '#/web/components/create-worktree-dialog/create-worktree-dialog.logic.ts'
import type { WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'

const MODE_OPTIONS = [
  { id: 'newBranch', labelKey: 'action.create-worktree-mode-new', icon: GitBranchPlus },
  { id: 'existingBranch', labelKey: 'action.create-worktree-mode-existing', icon: GitBranch },
  { id: 'trackRemoteBranch', labelKey: 'action.create-worktree-mode-remote', icon: RadioTower },
] satisfies Array<{ id: CreateWorktreeDialogMode; labelKey: string; icon: LucideIcon }>

interface Props {
  open: boolean
  repo: RepoState
  worktreeBootstrap?: WorktreeBootstrapPromptState
  onClose: () => void
  onCreate: (request: CreateWorktreeRequest) => boolean | void | Promise<boolean | void>
}

interface WorktreeBootstrapPromptState {
  loading: boolean
  preview: WorktreeBootstrapPreview | null
  trusted: boolean
  trust: boolean
  onTrustChange: (checked: boolean) => void
}

export function CreateWorktreeDialog({ open, repo, worktreeBootstrap, onClose, onCreate }: Props) {
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
  const [submitting, setSubmitting] = useState(false)

  // Reset on the rising edge of `open` only. A guard ref prevents snapshot
  // refreshes (which change repo.data.branches / currentBranch) from wiping
  // user input while the dialog stays open. The ref starts false so the
  // first render with open=true still triggers the reset.
  const previousOpenRef = useRef(false)
  useEffect(() => {
    const wasClosed = !previousOpenRef.current && open
    previousOpenRef.current = open
    if (!wasClosed) return
    const initialBase = repo.data.currentBranch || repo.data.branches[0]?.name || ''
    setMode('newBranch')
    setBase(initialBase)
    setBranch('')
    setExistingBranch(initialBase)
    setRemoteRef('')
    setLocalBranch('')
    setWorktreePath('')
    setRemoteBranches([])
    setRemoteBranchesLoading(false)
    setSubmitting(false)
  }, [open, repo.data.branches, repo.data.currentBranch])

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
  const derived = deriveCreateWorktreeForm(
    { mode, base, branch, existingBranch, remoteRef, localBranch, worktreePath, remoteBranches },
    repo,
    remoteTarget,
    t,
  )

  const branchActionBusy = repo.operations.branchAction.phase !== 'idle'
  const bootstrapBusy = worktreeBootstrap?.loading === true
  const canSubmit = !!derived.input && derived.validPath && !branchActionBusy && !bootstrapBusy && !submitting

  async function handleSubmit(): Promise<void> {
    const nextInput = derived.input
    if (!nextInput || branchActionBusy || bootstrapBusy || submitting) return
    setSubmitting(true)
    let shouldClose = false
    try {
      const result = await onCreate({ input: nextInput })
      shouldClose = result !== false
    } finally {
      setSubmitting(false)
    }
    if (shouldClose) onClose()
  }

  const remotePathSuggestions = useRemotePathSuggestions({
    enabled: open && !!remoteTarget && derived.pathName.length > 0,
    alias: remoteTarget?.alias ?? '',
    remotePath: remoteTarget?.remotePath ?? '/',
    prefix: worktreePath,
  })

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
          void handleSubmit()
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
              return (
                <ToggleGroupItem
                  key={option.id}
                  value={option.id}
                  className="flex min-h-8 flex-1 items-center justify-center gap-1 px-2 text-xs"
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
                <Field className="gap-2" data-invalid={derived.baseError ? true : undefined}>
                  <FieldLabel htmlFor="cwt-base">{t('action.create-worktree-base-label')}</FieldLabel>
                  <Select value={base} onValueChange={setBase}>
                    <SelectTrigger
                      id="cwt-base"
                      className="h-10 w-full text-sm"
                      aria-invalid={!!derived.baseError}
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
                    {derived.baseError}
                  </FieldError>
                </Field>

                <Field className="gap-2" data-invalid={derived.branchError ? true : undefined}>
                  <FieldLabel htmlFor="cwt-branch">{t('action.create-worktree-branch-label')}</FieldLabel>
                  <Input
                    id="cwt-branch"
                    autoFocus
                    className="h-10 text-sm"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder={t('action.create-worktree-branch-placeholder')}
                    aria-invalid={!!derived.branchError}
                    aria-describedby="cwt-branch-error"
                  />
                  <FieldError id="cwt-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
                    {derived.branchError}
                  </FieldError>
                </Field>
              </>
            )}

            {mode === 'existingBranch' && (
              <Field className="gap-2" data-invalid={derived.existingBranchError ? true : undefined}>
                <FieldLabel htmlFor="cwt-existing-branch">{t('action.create-worktree-existing-label')}</FieldLabel>
                <Select value={existingBranch} onValueChange={setExistingBranch}>
                  <SelectTrigger
                    id="cwt-existing-branch"
                    className="h-10 w-full text-sm"
                    aria-invalid={!!derived.existingBranchError}
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
                  {derived.existingBranchError}
                </FieldError>
              </Field>
            )}

            {mode === 'trackRemoteBranch' && (
              <>
                <Field className="gap-2">
                  <FieldLabel htmlFor="cwt-remote-ref">{t('action.create-worktree-remote-label')}</FieldLabel>
                  <Select
                    value={derived.selectedRemoteRef}
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

                <Field className="gap-2" data-invalid={derived.localBranchError ? true : undefined}>
                  <FieldLabel htmlFor="cwt-local-branch">{t('action.create-worktree-local-branch-label')}</FieldLabel>
                  <Input
                    id="cwt-local-branch"
                    className="h-10 text-sm"
                    value={localBranch}
                    onChange={(e) => setLocalBranch(e.target.value)}
                    placeholder={derived.derivedLocalBranch || t('action.create-worktree-local-branch-placeholder')}
                    aria-invalid={!!derived.localBranchError}
                    aria-describedby="cwt-local-branch-error"
                  />
                  <FieldError id="cwt-local-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
                    {derived.localBranchError}
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
              disabled={!derived.pathName}
              onChange={setWorktreePath}
              suggestions={remotePathSuggestions.suggestions}
              isLoading={remotePathSuggestions.isLoading}
              hasFetched={remotePathSuggestions.hasFetched}
              emptyLabel={t('repo-picker.open-remote-path-no-matches')}
              placeholder={derived.displayDefaultPath}
              aria-describedby="cwt-path-hint"
            />
          ) : (
            <Input
              id="cwt-path"
              value={worktreePath}
              disabled={!derived.pathName}
              onChange={(e) => setWorktreePath(e.target.value)}
              placeholder={derived.displayDefaultPath}
              aria-describedby="cwt-path-hint"
              className="h-10 font-mono text-sm"
            />
          )}
          <FieldDescription
            id="cwt-path-hint"
            reserveHeight
            className="truncate"
            title={derived.displayEffectivePath || undefined}
          >
            {derived.pathHintText}
          </FieldDescription>
        </Field>

        <WorktreeBootstrapPrompt state={worktreeBootstrap} />

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

function WorktreeBootstrapPrompt({ state }: { state: WorktreeBootstrapPromptState | undefined }) {
  const t = useT()
  const preview = state?.preview ?? null
  const showPrompt = state?.loading || (preview?.hasOperations && preview.configHash)
  if (!state || !showPrompt) return null
  const rows = preview ? bootstrapRows(preview, t) : []

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="font-medium leading-none">{t('action.create-worktree-bootstrap-title')}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {state.loading ? t('action.create-worktree-bootstrap-loading') : t('action.create-worktree-bootstrap-body')}
          </p>
          {!state.loading && preview && (
            <>
              {rows.length > 0 && (
                <dl className="grid gap-1.5 border-y py-2 text-xs">
                  {rows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-3">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-mono text-foreground tabular-nums">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {preview.setup && (
                <div className="space-y-1">
                  <span className="block text-xs text-muted-foreground">
                    {t('action.create-worktree-bootstrap-setup-label')}
                  </span>
                  <code className="block max-h-20 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-foreground">
                    {preview.setup.command}
                  </code>
                </div>
              )}
              {state.trusted ? (
                <p className="text-xs text-muted-foreground">{t('action.create-worktree-bootstrap-trusted')}</p>
              ) : (
                <>
                  <ConfirmCheckbox checked={state.trust} onCheckedChange={state.onTrustChange}>
                    {t('action.create-worktree-bootstrap-remember')}
                  </ConfirmCheckbox>
                  <p className="text-xs text-muted-foreground">{t('action.create-worktree-bootstrap-note')}</p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function bootstrapRows(preview: WorktreeBootstrapPreview, t: (key: string) => string) {
  const rows: Array<{ label: string; value: number }> = []
  if (preview.copyCount > 0)
    rows.push({ label: t('action.create-worktree-bootstrap-copy-label'), value: preview.copyCount })
  if (preview.symlinkCount > 0)
    rows.push({ label: t('action.create-worktree-bootstrap-symlink-label'), value: preview.symlinkCount })
  if (preview.hardlinkCount > 0)
    rows.push({ label: t('action.create-worktree-bootstrap-hardlink-label'), value: preview.hardlinkCount })
  if (preview.excludeCount > 0)
    rows.push({ label: t('action.create-worktree-bootstrap-exclude-label'), value: preview.excludeCount })
  return rows
}
