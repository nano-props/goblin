import { GitBranchPlus } from '@lucide/vue'
import { computed, defineComponent, ref, watch } from 'vue'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { beginAppNavigation } from '#/web/app-navigation-lifecycle.ts'
import type { AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { ScrollPane } from '#/web/components/Layout.tsx'
import { RepoStatusFailureView, RepoStatusStaleNotice } from '#/web/components/RepoStatusFailureView.tsx'
import {
  isConfigTrustStateLoading,
  resolveConfigTrusted,
  resolveNextConfigTrustChoice,
  resolveWorktreeBootstrapDecision,
} from '#/web/components/create-worktree/create-worktree-bootstrap-host.logic.ts'
import { CreateWorktreePageBody } from '#/web/components/create-worktree/CreateWorktreeSurface.tsx'
import type { WorktreeBootstrapPromptState } from '#/web/components/create-worktree/CreateWorktreeSurface.tsx'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree/create-worktree.logic.ts'
import {
  WorkspacePageLoadingBody,
  WorkspacePagePane,
  WorkspacePageQuietLoadingBody,
} from '#/web/components/workspace-pages/WorkspacePagePane.tsx'
import { useLoadingVisibility } from '#/web/hooks/useLoadingVisibility.ts'
import { projectBranchActionOperation, projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { waitForPromiseWithSignal } from '#/web/lib/abort.ts'
import { getRepoWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { repoWorktreeBootstrapPreviewQueryKey } from '#/web/repo-query-keys.ts'
import { useRepoOperationsReadModel, useRepoSnapshotReadModel } from '#/web/repo-queries.ts'
import { settingsSnapshotQueryOptions } from '#/web/settings-queries.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { RepoOperationState } from '#/web/stores/workspaces/operations.ts'

type ConfigTrustChoice = { key: string; value: boolean } | null

interface BootstrapLoad {
  repoId: WorkspaceId
  workspaceRuntimeId: string
  previewResult: WorktreeBootstrapPreviewResult
  settingsSnapshot?: SettingsSnapshot
  settingsError: boolean
}

interface CreateWorktreePagePaneProps {
  repoId: WorkspaceId
  compact?: boolean
  trafficLightOffset?: boolean
  onCancel: () => void
  onCreated: (branchName: string, navigationGeneration: AppNavigationGeneration) => void
}

type GitCreateWorktreeWorkspace = Pick<WorkspaceState, 'id' | 'workspaceRuntimeId' | 'admission'> & {
  branchAction: RepoOperationState
}

interface GitCreateWorktreePagePaneProps extends Omit<CreateWorktreePagePaneProps, 'repoId'> {
  workspace: GitCreateWorktreeWorkspace
}

export const CreateWorktreePagePane = defineComponent<CreateWorktreePagePaneProps>({
  name: 'CreateWorktreePagePane',
  inheritAttrs: false,
  props: ['repoId', 'compact', 'trafficLightOffset', 'onCancel', 'onCreated'],
  setup(props) {
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const workspace = computed<GitCreateWorktreeWorkspace | null>(() => {
      const current = workspaces.value[props.repoId]
      return current?.capability.kind === 'git'
        ? {
            id: current.id,
            workspaceRuntimeId: current.workspaceRuntimeId,
            admission: current.admission,
            branchAction: current.capability.git.operations.branchAction,
          }
        : null
    })
    const showLoadingSkeleton = useLoadingVisibility(() => workspace.value === null)

    return () => {
      const currentWorkspace = workspace.value
      const compact = props.compact ?? false
      const trafficLightOffset = props.trafficLightOffset ?? false
      return currentWorkspace ? (
        <GitCreateWorktreePagePane
          workspace={currentWorkspace}
          compact={compact}
          trafficLightOffset={trafficLightOffset}
          onCancel={props.onCancel}
          onCreated={props.onCreated}
        />
      ) : (
        <CreateWorktreePageShell compact={compact} trafficLightOffset={trafficLightOffset} onBack={props.onCancel}>
          {showLoadingSkeleton.value ? <WorkspacePageLoadingBody /> : <WorkspacePageQuietLoadingBody />}
        </CreateWorktreePageShell>
      )
    }
  },
})

const GitCreateWorktreePagePane = defineComponent<GitCreateWorktreePagePaneProps>({
  name: 'GitCreateWorktreePagePane',
  inheritAttrs: false,
  props: ['workspace', 'compact', 'trafficLightOffset', 'onCancel', 'onCreated'],
  setup(props) {
    const snapshotReadModel = useRepoSnapshotReadModel(
      () => props.workspace.id,
      () => props.workspace.workspaceRuntimeId,
    )
    const operationsReadModel = useRepoOperationsReadModel(
      () => props.workspace.id,
      () => props.workspace.workspaceRuntimeId,
    )
    const configTrustChoice = ref<ConfigTrustChoice>(null)
    const bootstrapLoad = ref<BootstrapLoad | null>(null)
    const bootstrapLoading = ref(false)

    // The bootstrap request is owned by the authoritative runtime identity.
    // Replacing that identity must abort the obsolete read before starting one
    // for the new runtime.
    watch(
      [() => props.workspace.id, () => props.workspace.workspaceRuntimeId],
      ([repoId, runtimeId], _previous, onCleanup) => {
        bootstrapLoad.value = null
        bootstrapLoading.value = true
        configTrustChoice.value = null

        const controller = new AbortController()
        onCleanup(() => controller.abort())
        void loadBootstrap(repoId, runtimeId, controller.signal)
          .then((load) => {
            if (!controller.signal.aborted) bootstrapLoad.value = load
          })
          .catch(() => {
            if (controller.signal.aborted) return
            bootstrapLoad.value = {
              repoId,
              workspaceRuntimeId: runtimeId,
              previewResult: { ok: false, message: 'error.failed-read-repo' },
              settingsError: false,
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) bootstrapLoading.value = false
          })
      },
      { immediate: true },
    )

    const activeBootstrapLoad = computed(() => {
      const runtimeId = props.workspace.workspaceRuntimeId
      return isBootstrapLoadForRepo(bootstrapLoad.value, props.workspace.id, runtimeId) ? bootstrapLoad.value : null
    })
    const bootstrapPreviewResult = computed(() => activeBootstrapLoad.value?.previewResult)
    const bootstrapPreview = computed(() => {
      const result = bootstrapPreviewResult.value
      return result?.ok ? result.preview : null
    })
    const bootstrapPreviewError = computed(() => bootstrapPreviewResult.value?.ok === false)
    const bootstrapConfigHash = computed(() => bootstrapPreview.value?.configHash ?? null)
    const bootstrapTrustKey = computed(() => {
      const configHash = bootstrapConfigHash.value
      return configHash ? `${props.workspace.id}\u0000${props.workspace.workspaceRuntimeId}\u0000${configHash}` : null
    })
    const effectiveConfigTrustChoice = computed(() => {
      const choice = configTrustChoice.value
      return choice && choice.key === bootstrapTrustKey.value ? choice.value : null
    })
    const settingsSnapshot = computed(() => activeBootstrapLoad.value?.settingsSnapshot)
    const worktreeBootstrapTrustLoading = computed(() =>
      isConfigTrustStateLoading({
        preview: bootstrapPreview.value,
        settingsReady: !!settingsSnapshot.value || !!activeBootstrapLoad.value?.settingsError,
      }),
    )
    const bootstrapDecisionReady = computed(
      () =>
        !bootstrapLoading.value &&
        (bootstrapPreviewError.value || (bootstrapPreview.value !== null && !worktreeBootstrapTrustLoading.value)),
    )
    const pageReady = computed(
      () => snapshotReadModel.data.value?.snapshot !== undefined && bootstrapDecisionReady.value,
    )
    const showLoadingSkeleton = useLoadingVisibility(() => !pageReady.value)
    const { runBranchAction } = workspacesStore.getState()

    function currentWorktreeBootstrapDecision(): WorktreeBootstrapDecision {
      return resolveWorktreeBootstrapDecision({
        preview: bootstrapPreview.value,
        workspaceSettings: settingsSnapshot.value?.workspaceSettings ?? [],
        workspaceId: props.workspace.id,
        configTrustChoice: effectiveConfigTrustChoice.value,
      })
    }

    async function createWorktree(request: CreateWorktreeRequest): Promise<boolean> {
      const repoId = props.workspace.id
      const workspaceRuntimeId = props.workspace.workspaceRuntimeId
      const onCreated = props.onCreated
      const currentRepo = workspacesStore.getState().workspaces[repoId]
      if (
        !currentRepo ||
        currentRepo.capability.kind !== 'git' ||
        currentRepo.workspaceRuntimeId !== workspaceRuntimeId
      ) {
        return false
      }
      const branchAction = projectBranchActionOperation(
        currentRepo.capability.git.operations.branchAction,
        operationsReadModel.data.value?.operations,
      )
      if (branchAction.phase !== 'idle') return false
      const navigationGeneration = beginAppNavigation()
      const worktreeBootstrap = currentWorktreeBootstrapDecision()
      const result = await runBranchAction(
        repoId,
        {
          kind: 'createWorktree',
          input: request.input,
          worktreeBootstrap,
        },
        { workspaceRuntimeId },
      )
      if (result?.ok) onCreated(createWorktreeTargetBranch(request.input), navigationGeneration)
      return false
    }

    function setConfigTrusted(next: boolean): void {
      const snapshot = settingsSnapshot.value
      const trustKey = bootstrapTrustKey.value
      const serverTrusted = resolveConfigTrusted({
        workspaceSettings: snapshot?.workspaceSettings ?? [],
        workspaceId: props.workspace.id,
        configHash: bootstrapConfigHash.value,
        configTrustChoice: null,
      })
      const configTrusted = snapshot
        ? resolveConfigTrusted({
            workspaceSettings: snapshot.workspaceSettings,
            workspaceId: props.workspace.id,
            configHash: bootstrapConfigHash.value,
            configTrustChoice: effectiveConfigTrustChoice.value,
          })
        : false
      const currentChoice = configTrustChoice.value?.key === trustKey ? configTrustChoice.value.value : null
      const nextValue = resolveNextConfigTrustChoice({
        next,
        currentTrusted: configTrusted,
        serverTrusted,
        currentChoice,
      })
      configTrustChoice.value = nextValue === null || !trustKey ? null : { key: trustKey, value: nextValue }
    }

    return () => {
      const currentLiveRepo = props.workspace
      const snapshot = snapshotReadModel.data.value?.snapshot
      const compact = props.compact ?? false
      const trafficLightOffset = props.trafficLightOffset ?? false
      const holdLoadingPage = !pageReady.value || showLoadingSkeleton.value

      if (!snapshot && snapshotReadModel.isError.value) {
        const snapshotError = snapshotReadModel.error.value
        const messageKey = snapshotError instanceof Error ? snapshotError.message : String(snapshotError ?? '')
        return (
          <CreateWorktreePageShell compact={compact} trafficLightOffset={trafficLightOffset} onBack={props.onCancel}>
            <RepoStatusFailureView
              messageKey={messageKey || 'error.failed-read-repo'}
              retrying={snapshotReadModel.isFetching.value}
              onRetry={() => void snapshotReadModel.refetch()}
            />
          </CreateWorktreePageShell>
        )
      }

      if (holdLoadingPage || !snapshot) {
        return (
          <CreateWorktreePageShell compact={compact} trafficLightOffset={trafficLightOffset} onBack={props.onCancel}>
            {showLoadingSkeleton.value ? <WorkspacePageLoadingBody /> : <WorkspacePageQuietLoadingBody />}
          </CreateWorktreePageShell>
        )
      }

      const snapshotError = snapshotReadModel.error.value
      const staleMessageKey =
        snapshotError instanceof Error ? snapshotError.message : String(snapshotError ?? 'error.failed-read-repo')
      const currentSettingsSnapshot = settingsSnapshot.value
      const configTrusted = currentSettingsSnapshot
        ? resolveConfigTrusted({
            workspaceSettings: currentSettingsSnapshot.workspaceSettings,
            workspaceId: props.workspace.id,
            configHash: bootstrapConfigHash.value,
            configTrustChoice: effectiveConfigTrustChoice.value,
          })
        : false
      const worktreeBootstrap: WorktreeBootstrapPromptState = {
        loading: false,
        preview: bootstrapPreview.value,
        error: bootstrapPreviewError.value,
        configTrusted,
        onConfigTrustedChange: setConfigTrusted,
      }
      const projectedRepo = projectBranchActionRepo(
        {
          id: currentLiveRepo.id,
          workspaceRuntimeId: currentLiveRepo.workspaceRuntimeId,
          operations: { branchAction: currentLiveRepo.branchAction },
          snapshot,
          remoteLifecycle: currentLiveRepo.admission.kind === 'remote' ? currentLiveRepo.admission.lifecycle : null,
        },
        operationsReadModel.data.value?.operations,
      )

      return (
        <CreateWorktreePageShell compact={compact} trafficLightOffset={trafficLightOffset} onBack={props.onCancel}>
          {snapshotReadModel.isError.value ? (
            <RepoStatusStaleNotice
              messageKey={staleMessageKey}
              retrying={snapshotReadModel.isFetching.value}
              onRetry={() => void snapshotReadModel.refetch()}
            />
          ) : null}
          <ScrollPane>
            <CreateWorktreePageBody
              repo={projectedRepo}
              worktreeBootstrap={worktreeBootstrap}
              onCancel={props.onCancel}
              onCreate={createWorktree}
            />
          </ScrollPane>
        </CreateWorktreePageShell>
      )
    }
  },
})

interface CreateWorktreePageShellProps {
  compact: boolean
  trafficLightOffset: boolean
  onBack: () => void
}

const CreateWorktreePageShell = defineComponent<CreateWorktreePageShellProps>({
  name: 'CreateWorktreePageShell',
  props: ['compact', 'trafficLightOffset', 'onBack'],
  setup(props, { slots }) {
    const t = useT()
    return () => (
      <WorkspacePagePane
        icon={GitBranchPlus}
        label={t('action.create-worktree-title')}
        compact={props.compact}
        trafficLightOffset={props.trafficLightOffset}
        onBack={props.onBack}
      >
        {slots.default?.()}
      </WorkspacePagePane>
    )
  },
})

function createWorktreeTargetBranch(input: CreateWorktreeRequest['input']): string {
  switch (input.mode.kind) {
    case 'newBranch':
      return input.mode.newBranch
    case 'existingBranch':
      return input.mode.branch
    case 'trackRemoteBranch':
      return input.mode.localBranch
  }
  const exhaustive: never = input.mode
  return exhaustive
}

function isBootstrapLoadForRepo(load: BootstrapLoad | null, repoId: WorkspaceId, workspaceRuntimeId: string): boolean {
  return load?.repoId === repoId && load.workspaceRuntimeId === workspaceRuntimeId
}

async function loadBootstrap(
  repoId: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
): Promise<BootstrapLoad> {
  const previewRead = appQueryClient.fetchQuery({
    queryKey: repoWorktreeBootstrapPreviewQueryKey(repoId, workspaceRuntimeId),
    queryFn: () =>
      getRepoWorktreeBootstrapPreview(repoId, workspaceRuntimeId).catch((): WorktreeBootstrapPreviewResult => ({
        ok: false,
        message: 'error.failed-read-repo',
      })),
    staleTime: 0,
  })
  const previewResult = await waitForPromiseWithSignal(previewRead, signal)
  let settingsSnapshot: SettingsSnapshot | undefined
  let settingsError = false

  if (previewResult.ok && previewResult.preview.hasOperations && previewResult.preview.configHash) {
    try {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      settingsSnapshot = await waitForPromiseWithSignal(
        appQueryClient.fetchQuery(settingsSnapshotQueryOptions()),
        signal,
      )
    } catch {
      settingsError = true
    }
  }

  return { repoId, workspaceRuntimeId, previewResult, settingsSnapshot, settingsError }
}
