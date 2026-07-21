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
import { DirectoryPathSuggestions } from '#/web/components/ui/directory-path-suggestions.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/web/components/ui/toggle-group.tsx'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'
import { useDirectoryPathSuggestions } from '#/web/hooks/useDirectoryPathSuggestions.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceAdmissionState, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { RepoOperationState } from '#/web/stores/workspaces/operations.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useRepoRemoteBranchesQuery } from '#/web/repo-queries.ts'
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

interface CreateWorktreeRepo {
  id: WorkspaceState['id']
  workspaceRuntimeId: WorkspaceState['workspaceRuntimeId']
  branchModel: RepoBranchReadModelData
  branchAction: RepoOperationState
  remoteLifecycle: Extract<WorkspaceAdmissionState, { kind: 'remote' }>['lifecycle']
}

export interface WorktreeBootstrapPromptState {
  loading: boolean
  preview: WorktreeBootstrapPreview | null
  error: boolean
  configTrusted: boolean
  onConfigTrustedChange: (trust: boolean) => void
}

export function CreateWorktreePageBody({ repo, worktreeBootstrap, onCancel, onCreate }: CreateWorktreeFormProps) {
  const t = useT()

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-sm leading-tight font-semibold">{t('action.create-worktree-title')}</h1>
        <p className="text-sm text-muted-foreground">{t('action.create-worktree-hint')}</p>
      </div>
      <CreateWorktreeForm repo={repo} worktreeBootstrap={worktreeBootstrap} onCancel={onCancel} onCreate={onCreate} />
    </div>
  )
}

interface CreateWorktreeFormProps {
  repo: CreateWorktreeRepo
  worktreeBootstrap?: WorktreeBootstrapPromptState
  onCancel: () => void
  onCreate: (request: CreateWorktreeRequest) => boolean | void | Promise<boolean | void>
}

type CreateWorktreeFormPhase = 'editing' | 'creating'

export function CreateWorktreeForm({ repo, worktreeBootstrap, onCancel, onCreate }: CreateWorktreeFormProps) {
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
  const [formPhase, setFormPhase] = useState<CreateWorktreeFormPhase>('editing')
  const creating = formPhase === 'creating'
  const remoteBranchesQuery = useRepoRemoteBranchesQuery(repo.id, repo.workspaceRuntimeId, {
    enabled: mode === 'trackRemoteBranch' && !creating,
  })
  const remoteBranches = remoteBranchesQuery.data ?? []
  const remoteBranchesLoading = remoteBranchesQuery.isLoading

  const remoteTarget = remoteWorkspaceTarget(repo.id, repo.remoteLifecycle)
  const derived = deriveCreateWorktreeForm(
    { mode, base, branch, existingBranch, remoteRef, localBranch, worktreePath, remoteBranches },
    repo,
    remoteTarget,
    t,
  )

  const branchActionBusy = repo.branchAction.phase !== 'idle'
  const bootstrapBusy = worktreeBootstrap?.loading === true
  const canSubmit =
    !!derived.input && derived.validPath && !branchActionBusy && !bootstrapBusy && formPhase === 'editing'
  const baseError = creating ? '' : derived.baseError
  const branchError = creating ? '' : derived.branchError
  const existingBranchError = creating ? '' : derived.existingBranchError
  const localBranchError = creating ? '' : derived.localBranchError

  async function handleSubmit(): Promise<void> {
    const nextInput = derived.input
    if (!nextInput || branchActionBusy || bootstrapBusy || formPhase !== 'editing') return
    setFormPhase('creating')
    let shouldClose = false
    try {
      const result = await onCreate({ input: nextInput })
      shouldClose = result !== false
    } finally {
      setFormPhase('editing')
    }
    if (shouldClose) onCancel()
  }

  const remotePathSuggestions = useDirectoryPathSuggestions({
    enabled: !creating && !!remoteTarget && derived.pathName.length > 0,
    source: { kind: 'ssh', alias: remoteTarget?.alias ?? '' },
    prefix: worktreePath,
  })

  return (
    <div>
      <form
        className="space-y-3"
        aria-busy={creating}
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
            disabled={creating}
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
                <Field className="gap-2" data-invalid={baseError ? true : undefined}>
                  <FieldLabel htmlFor="cwt-base">{t('action.create-worktree-base-label')}</FieldLabel>
                  <Select value={base} onValueChange={setBase} disabled={creating}>
                    <SelectTrigger
                      id="cwt-base"
                      className="h-10 w-full text-sm"
                      aria-invalid={!!baseError}
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
                    {baseError}
                  </FieldError>
                </Field>

                <Field className="gap-2" data-invalid={branchError ? true : undefined}>
                  <FieldLabel htmlFor="cwt-branch">{t('action.create-worktree-branch-label')}</FieldLabel>
                  <Input
                    id="cwt-branch"
                    className="h-10 text-sm"
                    value={branch}
                    disabled={creating}
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
                <Select value={existingBranch} onValueChange={setExistingBranch} disabled={creating}>
                  <SelectTrigger
                    id="cwt-existing-branch"
                    className="h-10 w-full text-sm"
                    aria-invalid={!!existingBranchError}
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
                  {existingBranchError}
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
                    disabled={creating || remoteBranches.length === 0}
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
                    disabled={creating}
                    onChange={(e) => setLocalBranch(e.target.value)}
                    placeholder={derived.derivedLocalBranch || t('action.create-worktree-local-branch-placeholder')}
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
        </CreateWorktreeAnimatedSection>

        <Field className="gap-2">
          <FieldLabel htmlFor="cwt-path">{t('action.create-worktree-path-label')}</FieldLabel>
          {remoteTarget ? (
            <DirectoryPathSuggestions
              id="cwt-path"
              value={worktreePath}
              disabled={creating || !derived.pathName}
              onChange={setWorktreePath}
              suggestions={remotePathSuggestions.suggestions}
              isLoading={remotePathSuggestions.isLoading}
              hasFetched={remotePathSuggestions.hasFetched}
              emptyLabel={t('workspace-picker.open-remote-path-no-matches')}
              placeholder={derived.displayDefaultPath}
              aria-describedby="cwt-path-hint"
            />
          ) : (
            <Input
              id="cwt-path"
              value={worktreePath}
              disabled={creating || !derived.pathName}
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

        <WorktreeBootstrapTrustRow state={worktreeBootstrap} disabled={creating} />

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className={cn(compact && 'w-full')}
            disabled={creating}
            onClick={onCancel}
          >
            {t('action.create-worktree-cancel')}
          </Button>
          <Button type="submit" className={cn('min-w-28', compact && 'w-full min-w-0')} disabled={!canSubmit}>
            {creating ? t('action.create-worktree-creating-title') : t('action.create-worktree-confirm')}
          </Button>
        </div>
      </form>
    </div>
  )
}

function CreateWorktreeAnimatedSection({ children, present = true }: { children: React.ReactNode; present?: boolean }) {
  return <CollapseTransition present={present}>{children}</CollapseTransition>
}

function WorktreeBootstrapTrustRow({
  state,
  disabled = false,
}: {
  state: WorktreeBootstrapPromptState | undefined
  disabled?: boolean
}) {
  if (!shouldShowWorktreeBootstrapTrust(state)) return null
  return <WorktreeBootstrapTrustCheckbox state={state} disabled={disabled} />
}

function WorktreeBootstrapTrustCheckbox({
  state,
  disabled = false,
}: {
  state: WorktreeBootstrapPromptState | undefined
  disabled?: boolean
}) {
  const t = useT()
  if (!state) return null

  return (
    <div className="pt-0.5 text-sm">
      <ConfirmCheckbox checked={state.configTrusted} disabled={disabled} onCheckedChange={state.onConfigTrustedChange}>
        {t('action.create-worktree-bootstrap-config-trusted')}
      </ConfirmCheckbox>
    </div>
  )
}

function shouldShowWorktreeBootstrapTrust(state: WorktreeBootstrapPromptState | undefined): boolean {
  const preview = state?.preview ?? null
  return !state?.loading && !state?.error && preview?.hasOperations === true && !!preview.configHash
}
