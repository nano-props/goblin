// Single-page form for creating a linked worktree.

import { GitBranch, GitBranchPlus, RadioTower } from '@lucide/vue'
import type { LucideIcon } from '@lucide/vue'
import { SelectRoot } from 'reka-ui'
import { computed, defineComponent, ref } from 'vue'
import type { FunctionalComponent } from 'vue'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'
import { ConfirmCheckbox } from '#/web/components/ConfirmCheckbox.tsx'
import {
  deriveCreateWorktreeForm,
  initialCreateWorktreeBase,
  remoteTrackingBranchKey,
} from '#/web/components/create-worktree/create-worktree.logic.ts'
import type {
  CreateWorktreeMode,
  CreateWorktreeRequest,
} from '#/web/components/create-worktree/create-worktree.logic.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { CollapseTransition } from '#/web/components/ui/collapse-transition.tsx'
import { DirectoryPathSuggestions } from '#/web/components/ui/directory-path-suggestions.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/web/components/ui/field.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { SelectContent, SelectItem, SelectTrigger } from '#/web/components/ui/select.tsx'
import { SelectValue } from '#/web/components/ui/SelectValue.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/web/components/ui/toggle-group.tsx'
import { useDirectoryPathSuggestions } from '#/web/hooks/useDirectoryPathSuggestions.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useRepoRemoteBranchesQuery } from '#/web/repo-queries.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { RepoOperationState } from '#/web/stores/workspaces/operations.ts'
import { remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceAdmissionState, WorkspaceState } from '#/web/stores/workspaces/types.ts'

const MODE_OPTIONS = [
  { id: 'newBranch', labelKey: 'action.create-worktree-mode-new', icon: GitBranchPlus },
  { id: 'existingBranch', labelKey: 'action.create-worktree-mode-existing', icon: GitBranch },
  { id: 'trackRemoteBranch', labelKey: 'action.create-worktree-mode-remote', icon: RadioTower },
] as const satisfies ReadonlyArray<{ id: CreateWorktreeMode; labelKey: string; icon: LucideIcon }>

interface CreateWorktreeRepo {
  id: WorkspaceState['id']
  workspaceRuntimeId: WorkspaceState['workspaceRuntimeId']
  snapshot: RepoSnapshot
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

interface CreateWorktreeFormProps {
  repo: CreateWorktreeRepo
  worktreeBootstrap?: WorktreeBootstrapPromptState
  onCancel: () => void
  onCreate: (request: CreateWorktreeRequest) => boolean | void | Promise<boolean | void>
}

export const CreateWorktreePageBody = defineComponent<CreateWorktreeFormProps>({
  name: 'CreateWorktreePageBody',
  props: ['repo', 'worktreeBootstrap', 'onCancel', 'onCreate'],
  setup(props) {
    const t = useT()
    return () => (
      <div class="flex w-full flex-col gap-4 p-6">
        <div class="flex flex-col gap-2">
          <h1 class="text-sm font-semibold leading-tight">{t('action.create-worktree-title')}</h1>
          <p class="text-sm text-muted-foreground">{t('action.create-worktree-hint')}</p>
        </div>
        <CreateWorktreeForm
          repo={props.repo}
          worktreeBootstrap={props.worktreeBootstrap}
          onCancel={props.onCancel}
          onCreate={props.onCreate}
        />
      </div>
    )
  },
})

type CreateWorktreeFormPhase = 'editing' | 'creating'

export const CreateWorktreeForm = defineComponent<CreateWorktreeFormProps>({
  name: 'CreateWorktreeForm',
  props: ['repo', 'worktreeBootstrap', 'onCancel', 'onCreate'],
  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()
    const mode = ref<CreateWorktreeMode>('newBranch')
    const initialBase = initialCreateWorktreeBase(props.repo.snapshot)
    const base = ref(initialBase)
    const branch = ref('')
    const existingBranch = ref(initialBase)
    const remoteSelection = ref('')
    const localBranch = ref('')
    const worktreePath = ref('')
    const formPhase = ref<CreateWorktreeFormPhase>('editing')
    const creating = computed(() => formPhase.value === 'creating')
    const remoteBranchesQuery = useRepoRemoteBranchesQuery(
      () => props.repo.id,
      () => props.repo.workspaceRuntimeId,
      { enabled: () => mode.value === 'trackRemoteBranch' && !creating.value },
    )
    const remoteBranches = computed(() => remoteBranchesQuery.data.value ?? [])
    const remoteTarget = computed(() => remoteWorkspaceTarget(props.repo.id, props.repo.remoteLifecycle))
    const derived = computed(() =>
      deriveCreateWorktreeForm(
        {
          mode: mode.value,
          base: base.value,
          branch: branch.value,
          existingBranch: existingBranch.value,
          remoteSelection: remoteSelection.value,
          localBranch: localBranch.value,
          worktreePath: worktreePath.value,
          remoteBranches: remoteBranches.value,
        },
        props.repo,
        remoteTarget.value,
        t,
      ),
    )
    const remotePathSuggestions = useDirectoryPathSuggestions({
      enabled: () => !creating.value && !!remoteTarget.value && derived.value.pathName.length > 0,
      source: () => ({ kind: 'ssh', alias: remoteTarget.value?.alias ?? '' }),
      prefix: worktreePath,
    })

    async function submit(): Promise<void> {
      const nextInput = derived.value.input
      const branchActionBusy = props.repo.branchAction.phase !== 'idle'
      const bootstrapBusy = props.worktreeBootstrap?.loading === true
      if (!nextInput || branchActionBusy || bootstrapBusy || formPhase.value !== 'editing') return
      const onCreate = props.onCreate
      const onCancel = props.onCancel
      formPhase.value = 'creating'
      let shouldClose = false
      try {
        const result = await onCreate({ input: nextInput })
        shouldClose = result !== false
      } finally {
        formPhase.value = 'editing'
      }
      if (shouldClose) onCancel()
    }

    return () => {
      const currentDerived = derived.value
      const isCreating = creating.value
      const branchActionBusy = props.repo.branchAction.phase !== 'idle'
      const bootstrapBusy = props.worktreeBootstrap?.loading === true
      const canSubmit =
        !!currentDerived.input &&
        currentDerived.validPath &&
        !branchActionBusy &&
        !bootstrapBusy &&
        formPhase.value === 'editing'
      const baseError = isCreating ? '' : currentDerived.baseError
      const branchError = isCreating ? '' : currentDerived.branchError
      const existingBranchError = isCreating ? '' : currentDerived.existingBranchError
      const localBranchError = isCreating ? '' : currentDerived.localBranchError
      const selectedBase = props.repo.snapshot.branches.find((candidate) => candidate.name === base.value)

      return (
        <div>
          <form
            class="space-y-3"
            aria-busy={isCreating}
            onSubmit={(event: SubmitEvent) => {
              event.preventDefault()
              void submit()
            }}
          >
            <Field class="gap-2">
              <FieldLabel>{t('action.create-worktree-mode-label')}</FieldLabel>
              <ToggleGroup
                type="single"
                modelValue={mode.value}
                onUpdate:modelValue={(next) => {
                  if (isCreateWorktreeMode(next)) mode.value = next
                }}
                variant="outline"
                size="sm"
                class="w-full"
                disabled={isCreating}
                aria-label={t('action.create-worktree-mode-label')}
              >
                {MODE_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const modeLabelKey = option.labelKey
                  return (
                    <ToggleGroupItem
                      key={option.id}
                      value={option.id}
                      class="flex min-h-8 flex-1 items-center justify-center gap-1 px-2 text-xs"
                    >
                      <Icon size={14} />
                      <span class="truncate">{t(modeLabelKey)}</span>
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </Field>

            <CollapseTransition>
              <div class="space-y-3">
                {mode.value === 'newBranch' ? (
                  <>
                    <Field class="gap-2" data-invalid={baseError ? true : undefined}>
                      <FieldLabel for="cwt-base">{t('action.create-worktree-base-label')}</FieldLabel>
                      <SelectRoot
                        modelValue={base.value}
                        onUpdate:modelValue={(next) => {
                          if (typeof next === 'string') base.value = next
                        }}
                        disabled={isCreating}
                      >
                        <SelectTrigger
                          id="cwt-base"
                          class="h-10 w-full text-sm"
                          aria-invalid={!!baseError}
                          aria-describedby="cwt-base-error"
                        >
                          {selectedBase ? (
                            <SelectValue>
                              <span class="truncate">{selectedBase.name}</span>
                              {selectedBase.name === props.repo.snapshot.current ? (
                                <span class="ml-2 text-xs text-muted-foreground">
                                  {t('action.create-worktree-base-current')}
                                </span>
                              ) : null}
                            </SelectValue>
                          ) : (
                            <SelectValue placeholder={t('action.create-worktree-base-placeholder')} />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {props.repo.snapshot.branches.map((candidate) => (
                            <SelectItem key={candidate.name} value={candidate.name} textValue={candidate.name}>
                              <span class="truncate">{candidate.name}</span>
                              {candidate.name === props.repo.snapshot.current ? (
                                <span class="ml-2 text-xs text-muted-foreground">
                                  {t('action.create-worktree-base-current')}
                                </span>
                              ) : null}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </SelectRoot>
                      <FieldError id="cwt-base-error" reserveHeight aria-live="polite" aria-atomic="true">
                        {baseError}
                      </FieldError>
                    </Field>

                    <Field class="gap-2" data-invalid={branchError ? true : undefined}>
                      <FieldLabel for="cwt-branch">{t('action.create-worktree-branch-label')}</FieldLabel>
                      <Input
                        id="cwt-branch"
                        class="h-10 text-sm"
                        value={branch.value}
                        disabled={isCreating}
                        onInput={(event: Event) => {
                          if (event.currentTarget instanceof HTMLInputElement) branch.value = event.currentTarget.value
                        }}
                        placeholder={t('action.create-worktree-branch-placeholder')}
                        aria-invalid={!!branchError}
                        aria-describedby="cwt-branch-error"
                      />
                      <FieldError id="cwt-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
                        {branchError}
                      </FieldError>
                    </Field>
                  </>
                ) : null}

                {mode.value === 'existingBranch' ? (
                  <Field class="gap-2" data-invalid={existingBranchError ? true : undefined}>
                    <FieldLabel for="cwt-existing-branch">{t('action.create-worktree-existing-label')}</FieldLabel>
                    <SelectRoot
                      modelValue={existingBranch.value}
                      onUpdate:modelValue={(next) => {
                        if (typeof next === 'string') existingBranch.value = next
                      }}
                      disabled={isCreating}
                    >
                      <SelectTrigger
                        id="cwt-existing-branch"
                        class="h-10 w-full text-sm"
                        aria-invalid={!!existingBranchError}
                        aria-describedby="cwt-existing-branch-error"
                      >
                        <SelectValue placeholder={t('action.create-worktree-existing-placeholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {props.repo.snapshot.branches.map((candidate) => (
                          <SelectItem key={candidate.name} value={candidate.name} textValue={candidate.name}>
                            <span class="truncate">{candidate.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </SelectRoot>
                    <FieldError id="cwt-existing-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
                      {existingBranchError}
                    </FieldError>
                  </Field>
                ) : null}

                {mode.value === 'trackRemoteBranch' ? (
                  <>
                    <Field class="gap-2">
                      <FieldLabel for="cwt-remote-ref">{t('action.create-worktree-remote-label')}</FieldLabel>
                      <SelectRoot
                        modelValue={currentDerived.selectedRemoteKey}
                        onUpdate:modelValue={(next) => {
                          if (typeof next !== 'string') return
                          remoteSelection.value = next
                          localBranch.value = ''
                        }}
                        disabled={isCreating || remoteBranches.value.length === 0}
                      >
                        <SelectTrigger id="cwt-remote-ref" class="h-10 w-full text-sm">
                          <SelectValue placeholder={t('action.create-worktree-remote-placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {remoteBranches.value.map((remote) => {
                            const remoteKey = remoteTrackingBranchKey(remote)
                            return (
                              <SelectItem
                                key={remoteKey}
                                value={remoteKey}
                                textValue={`${remote.remote}/${remote.branch}`}
                              >
                                <span class="truncate">
                                  {remote.remote}/{remote.branch}
                                </span>
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </SelectRoot>
                      <FieldDescription reserveHeight aria-live="polite" aria-atomic="true">
                        {remoteBranchesQuery.isLoading.value
                          ? t('action.create-worktree-remote-loading')
                          : remoteBranches.value.length === 0
                            ? t('action.create-worktree-remote-empty')
                            : ''}
                      </FieldDescription>
                    </Field>

                    <Field class="gap-2" data-invalid={localBranchError ? true : undefined}>
                      <FieldLabel for="cwt-local-branch">{t('action.create-worktree-local-branch-label')}</FieldLabel>
                      <Input
                        id="cwt-local-branch"
                        class="h-10 text-sm"
                        value={localBranch.value}
                        disabled={isCreating}
                        onInput={(event: Event) => {
                          if (event.currentTarget instanceof HTMLInputElement) {
                            localBranch.value = event.currentTarget.value
                          }
                        }}
                        placeholder={
                          currentDerived.derivedLocalBranch || t('action.create-worktree-local-branch-placeholder')
                        }
                        aria-invalid={!!localBranchError}
                        aria-describedby="cwt-local-branch-error"
                      />
                      <FieldError id="cwt-local-branch-error" reserveHeight aria-live="polite" aria-atomic="true">
                        {localBranchError}
                      </FieldError>
                    </Field>
                  </>
                ) : null}
              </div>
            </CollapseTransition>

            <Field class="gap-2">
              <FieldLabel for="cwt-path">{t('action.create-worktree-path-label')}</FieldLabel>
              {remoteTarget.value ? (
                <DirectoryPathSuggestions
                  id="cwt-path"
                  value={worktreePath.value}
                  disabled={isCreating || !currentDerived.pathName}
                  onChange={(next) => {
                    worktreePath.value = next
                  }}
                  suggestions={remotePathSuggestions.suggestions}
                  isLoading={remotePathSuggestions.isLoading}
                  hasFetched={remotePathSuggestions.hasFetched}
                  emptyLabel={t('workspace-picker.open-remote-path-no-matches')}
                  placeholder={currentDerived.displayDefaultPath}
                  aria-describedby="cwt-path-hint"
                />
              ) : (
                <Input
                  id="cwt-path"
                  value={worktreePath.value}
                  disabled={isCreating || !currentDerived.pathName}
                  onInput={(event: Event) => {
                    if (event.currentTarget instanceof HTMLInputElement) worktreePath.value = event.currentTarget.value
                  }}
                  placeholder={currentDerived.displayDefaultPath}
                  aria-describedby="cwt-path-hint"
                  class="h-10 font-mono text-sm"
                />
              )}
              <FieldDescription
                id="cwt-path-hint"
                reserveHeight
                class="truncate"
                title={currentDerived.displayEffectivePath || undefined}
              >
                {currentDerived.pathHintText}
              </FieldDescription>
            </Field>

            <WorktreeBootstrapTrustRow state={props.worktreeBootstrap} disabled={isCreating} />

            <div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                class={cn(compact.value && 'w-full')}
                disabled={isCreating}
                onClick={props.onCancel}
              >
                {t('action.create-worktree-cancel')}
              </Button>
              <Button type="submit" class={cn('min-w-28', compact.value && 'w-full min-w-0')} disabled={!canSubmit}>
                {isCreating ? t('action.create-worktree-creating-title') : t('action.create-worktree-confirm')}
              </Button>
            </div>
          </form>
        </div>
      )
    }
  },
})

interface WorktreeBootstrapTrustRowProps {
  state?: WorktreeBootstrapPromptState
  disabled?: boolean
}

const WorktreeBootstrapTrustRow: FunctionalComponent<WorktreeBootstrapTrustRowProps> = (props) =>
  shouldShowWorktreeBootstrapTrust(props.state) ? (
    <WorktreeBootstrapTrustCheckbox state={props.state} disabled={props.disabled ?? false} />
  ) : null

WorktreeBootstrapTrustRow.props = ['state', 'disabled']

const WorktreeBootstrapTrustCheckbox = defineComponent<WorktreeBootstrapTrustRowProps>({
  name: 'WorktreeBootstrapTrustCheckbox',
  props: ['state', 'disabled'],
  setup(props) {
    const t = useT()
    return () =>
      props.state ? (
        <div class="pt-0.5 text-sm">
          <ConfirmCheckbox
            checked={props.state.configTrusted}
            disabled={props.disabled ?? false}
            onCheckedChange={props.state.onConfigTrustedChange}
          >
            {t('action.create-worktree-bootstrap-config-trusted')}
          </ConfirmCheckbox>
        </div>
      ) : null
  },
})

function shouldShowWorktreeBootstrapTrust(state: WorktreeBootstrapPromptState | undefined): boolean {
  const preview = state?.preview ?? null
  return !state?.loading && !state?.error && preview?.hasOperations === true && !!preview.configHash
}

function isCreateWorktreeMode(value: unknown): value is CreateWorktreeMode {
  return value === 'newBranch' || value === 'existingBranch' || value === 'trackRemoteBranch'
}
