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

import { useState } from 'react'
import { GitBranch, GitBranchPlus, RadioTower, type LucideIcon } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/web/components/ui/select.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/web/components/ui/field.tsx'
import { CollapseTransition } from '#/web/components/ui/collapse-transition.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { RemotePathSuggestions } from '#/web/components/ui/remote-path-suggestions.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/web/components/ui/toggle-group.tsx'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'
import { useRemotePathSuggestions } from '#/web/hooks/useRemotePathSuggestions.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { remoteRepoTarget } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useRepoRemoteBranchesQuery } from '#/web/repo-data-query.ts'
import type { RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import { cn } from '#/web/lib/cn.ts'
import {
  deriveCreateWorktreeForm,
  type CreateWorktreeMode,
  type CreateWorktreeRequest,
} from '#/web/components/create-worktree/create-worktree.logic.ts'
import type { WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'

const MODE_OPTIONS = [
  { id: 'newBranch', labelKey: 'action.create-worktree-mode-new', icon: GitBranchPlus },
  { id: 'existingBranch', labelKey: 'action.create-worktree-mode-existing', icon: GitBranch },
  { id: 'trackRemoteBranch', labelKey: 'action.create-worktree-mode-remote', icon: RadioTower },
] satisfies Array<{ id: CreateWorktreeMode; labelKey: string; icon: LucideIcon }>

type CreateWorktreeRepo = RepoState & { branchModel: RepoBranchReadModelData }

export interface WorktreeBootstrapPromptState {
  loading: boolean
  preview: WorktreeBootstrapPreview | null
  error: boolean
  configTrusted: boolean
  onConfigTrustedChange: (trust: boolean) => void
}

export function CreateWorktreePageBody({
  repo,
  worktreeBootstrap,
  onCancel,
  onCreate,
}: CreateWorktreeFormProps) {
  const t = useT()

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-sm leading-tight font-semibold">{t('action.create-worktree-title')}</h1>
        <p className="text-sm text-muted-foreground">{t('action.create-worktree-hint')}</p>
      </div>
      <CreateWorktreeForm
        repo={repo}
        worktreeBootstrap={worktreeBootstrap}
        onCancel={onCancel}
        onCreate={onCreate}
      />
    </div>
  )
}

interface CreateWorktreeFormProps {
  repo: CreateWorktreeRepo
  worktreeBootstrap?: WorktreeBootstrapPromptState
  onCancel: () => void
  onCreate: (request: CreateWorktreeRequest) => boolean | void | Promise<boolean | void>
}

export function CreateWorktreeForm({
  repo,
  worktreeBootstrap,
  onCancel,
  onCreate,
}: CreateWorktreeFormProps) {
  const t = useT()
  const compact = useIsCompactUi()

  const [mode, setMode] = useState<CreateWorktreeMode>('newBranch')
  const initialBase = repo.branchModel.currentBranch || repo.branchModel.branches[0]?.name || ''
  const [base, setBase] = useState<string>(initialBase)
  const [branch, setBranch] = useState('')
  const [existingBranch, setExistingBranch] = useState(initialBase)
  const [remoteRef, setRemoteRef] = useState('')
  const [localBranch, setLocalBranch] = useState('')
  const [worktreePath, setWorktreePath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const remoteBranchesQuery = useRepoRemoteBranchesQuery(repo.id, repo.instanceId, {
    enabled: mode === 'trackRemoteBranch',
  })
  const remoteBranches = remoteBranchesQuery.data ?? []
  const remoteBranchesLoading = remoteBranchesQuery.isLoading

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
    if (shouldClose) onCancel()
  }

  const remotePathSuggestions = useRemotePathSuggestions({
    enabled: !!remoteTarget && derived.pathName.length > 0,
    alias: remoteTarget?.alias ?? '',
    remotePath: remoteTarget?.remotePath ?? '/',
    prefix: worktreePath,
  })

  return (
    <div>
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
              if (next) setMode(next as CreateWorktreeMode)
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

        <CreateWorktreeAnimatedSection>
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
                      {repo.branchModel.branches.map((b) => (
                        <SelectItem key={b.name} value={b.name} textValue={b.name}>
                          <span className="truncate">{b.name}</span>
                          {b.name === repo.branchModel.currentBranch && (
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
                    {repo.branchModel.branches.map((b) => (
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
        </CreateWorktreeAnimatedSection>

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

        <WorktreeBootstrapTrustRow state={worktreeBootstrap} />

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className={cn(compact && 'w-full')} onClick={onCancel}>
            {t('action.create-worktree-cancel')}
          </Button>
          <Button type="submit" className={cn('min-w-28', compact && 'w-full min-w-0')} disabled={!canSubmit}>
            {t('action.create-worktree-confirm')}
          </Button>
        </div>
      </form>
    </div>
  )
}

function CreateWorktreeAnimatedSection({ children, present = true }: { children: React.ReactNode; present?: boolean }) {
  return <CollapseTransition present={present}>{children}</CollapseTransition>
}

function WorktreeBootstrapTrustRow({ state }: { state: WorktreeBootstrapPromptState | undefined }) {
  // Page-level readiness in CreateWorktreePagePane already holds the whole
  // form in a skeleton until the bootstrap preview and settings both settle,
  // so this row never has to render during loading. Anything that should
  // appear under the path field resolves at the same instant the form does.
  if (!shouldShowWorktreeBootstrapTrust(state)) return null
  return <WorktreeBootstrapTrustCheckbox state={state} />
}

function WorktreeBootstrapTrustCheckbox({ state }: { state: WorktreeBootstrapPromptState | undefined }) {
  const t = useT()
  if (!state) return null

  return (
    <div className="pt-0.5 text-sm">
      <ConfirmCheckbox checked={state.configTrusted} onCheckedChange={state.onConfigTrustedChange}>
        {t('action.create-worktree-bootstrap-config-trusted')}
      </ConfirmCheckbox>
    </div>
  )
}

function shouldShowWorktreeBootstrapTrust(state: WorktreeBootstrapPromptState | undefined): boolean {
  const preview = state?.preview ?? null
  return !state?.loading && !state?.error && preview?.hasOperations === true && !!preview.configHash
}
