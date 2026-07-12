import { useEffect, useState, type ReactNode } from 'react'
import { GitBranchPlus } from 'lucide-react'
import { CreateWorktreePageBody } from '#/web/components/create-worktree/CreateWorktreeSurface.tsx'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree/create-worktree.logic.ts'
import {
  isConfigTrustStateLoading,
  resolveConfigTrusted,
  resolveNextConfigTrustChoice,
  resolveWorktreeBootstrapDecision,
} from '#/web/components/create-worktree/create-worktree-bootstrap-host.logic.ts'
import { ScrollPane } from '#/web/components/Layout.tsx'
import {
  RepoPageLoadingBody,
  RepoPagePane,
  RepoPageQuietLoadingBody,
} from '#/web/components/repo-pages/RepoPagePane.tsx'
import { useLoadingVisibility } from '#/web/hooks/useLoadingVisibility.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { getRepoWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { useRepoBranchReadModel } from '#/web/repo-branch-read-model.ts'
import { useRepoOperationsReadModel } from '#/web/repo-data-query.ts'
import { settingsSnapshotQueryOptions } from '#/web/settings-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { projectBranchActionOperation, projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'

type ConfigTrustChoice = { key: string; value: boolean } | null
type BootstrapLoad = {
  repoId: string
  repoRuntimeId: string
  previewResult: WorktreeBootstrapPreviewResult
  settingsSnapshot?: SettingsSnapshot
  settingsError: boolean
}

interface CreateWorktreePagePaneProps {
  repoId: string
  compact?: boolean
  trafficLightOffset?: boolean
  onCancel: () => void
  onCreated: (branchName: string) => void
}

export function CreateWorktreePagePane({
  repoId,
  compact = false,
  trafficLightOffset = false,
  onCancel,
  onCreated,
}: CreateWorktreePagePaneProps) {
  const liveRepo = useReposStore((s) => s.repos[repoId])
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const branchReadModel = useRepoBranchReadModel(liveRepo?.id ?? '', liveRepo?.repoRuntimeId ?? '', !!liveRepo)
  const operationsReadModel = useRepoOperationsReadModel(liveRepo?.id ?? '', liveRepo?.repoRuntimeId ?? '', {
    enabled: !!liveRepo,
  })
  const repoRuntimeId = liveRepo?.repoRuntimeId ?? null
  const [configTrustChoice, setConfigTrustChoice] = useState<ConfigTrustChoice>(null)
  const [bootstrapLoad, setBootstrapLoad] = useState<BootstrapLoad | null>(null)
  const [bootstrapLoading, setBootstrapLoading] = useState(false)

  useEffect(() => {
    if (repoRuntimeId === null) {
      setBootstrapLoad(null)
      setBootstrapLoading(false)
      setConfigTrustChoice(null)
      return
    }

    const controller = new AbortController()
    let ignore = false
    setBootstrapLoad(null)
    setBootstrapLoading(true)
    setConfigTrustChoice(null)

    void loadBootstrap(repoId, repoRuntimeId, controller.signal)
      .then((load) => {
        if (!ignore) setBootstrapLoad(load)
      })
      .finally(() => {
        if (!ignore) setBootstrapLoading(false)
      })

    return () => {
      ignore = true
      controller.abort()
    }
  }, [repoId, repoRuntimeId])

  const activeBootstrapLoad =
    repoRuntimeId && isBootstrapLoadForRepo(bootstrapLoad, repoId, repoRuntimeId) ? bootstrapLoad : null
  const bootstrapPreviewResult = activeBootstrapLoad?.previewResult
  const bootstrapPreview = bootstrapPreviewResult?.ok ? bootstrapPreviewResult.preview : null
  const bootstrapPreviewError = bootstrapPreviewResult?.ok === false
  const bootstrapConfigHash = bootstrapPreview?.configHash ?? null
  const bootstrapTrustKey = bootstrapConfigHash
    ? `${repoId}\u0000${repoRuntimeId ?? ''}\u0000${bootstrapConfigHash}`
    : null
  const effectiveConfigTrustChoice =
    configTrustChoice && configTrustChoice.key === bootstrapTrustKey ? configTrustChoice.value : null
  const settingsSnapshot = activeBootstrapLoad?.settingsSnapshot
  const settingsReady = !!settingsSnapshot || !!activeBootstrapLoad?.settingsError
  const worktreeBootstrapTrustLoading = isConfigTrustStateLoading({
    preview: bootstrapPreview,
    settingsReady,
  })
  const bootstrapDecisionReady =
    !bootstrapLoading && (bootstrapPreviewError || (bootstrapPreview !== null && !worktreeBootstrapTrustLoading))
  const pageReady = !!liveRepo && !!branchReadModel && bootstrapDecisionReady
  const showLoadingSkeleton = useLoadingVisibility(!pageReady)
  const holdLoadingPage = !pageReady || showLoadingSkeleton

  if (holdLoadingPage) {
    return (
      <CreateWorktreePageShell compact={compact} trafficLightOffset={trafficLightOffset} onBack={onCancel}>
        {showLoadingSkeleton ? <RepoPageLoadingBody /> : <RepoPageQuietLoadingBody />}
      </CreateWorktreePageShell>
    )
  }

  const serverConfigTrusted = resolveConfigTrusted({
    repoSettings: settingsSnapshot?.repoSettings ?? [],
    repoId,
    configHash: bootstrapConfigHash,
    configTrustChoice: null,
  })
  const configTrusted = settingsSnapshot
    ? resolveConfigTrusted({
        repoSettings: settingsSnapshot.repoSettings,
        repoId,
        configHash: bootstrapConfigHash,
        configTrustChoice: effectiveConfigTrustChoice,
      })
    : false
  const worktreeBootstrap = {
    loading: !bootstrapDecisionReady,
    preview: bootstrapPreview,
    error: bootstrapPreviewError,
    configTrusted,
    onConfigTrustedChange: (next: boolean) => {
      setConfigTrustChoice((currentChoice) => {
        const currentValue = currentChoice && currentChoice.key === bootstrapTrustKey ? currentChoice.value : null
        const nextValue = resolveNextConfigTrustChoice({
          next,
          currentTrusted: configTrusted,
          serverTrusted: serverConfigTrusted,
          currentChoice: currentValue,
        })
        return nextValue === null || !bootstrapTrustKey ? null : { key: bootstrapTrustKey, value: nextValue }
      })
    },
  }

  function currentWorktreeBootstrapDecision(): WorktreeBootstrapDecision {
    return resolveWorktreeBootstrapDecision({
      preview: bootstrapPreview,
      repoSettings: settingsSnapshot?.repoSettings ?? [],
      repoId,
      configTrustChoice: effectiveConfigTrustChoice,
    })
  }

  async function handleCreateWorktree(request: CreateWorktreeRequest): Promise<boolean> {
    const currentRepo = useReposStore.getState().repos[repoId]
    if (!currentRepo || currentRepo.repoRuntimeId !== liveRepo.repoRuntimeId) return false
    const branchAction = projectBranchActionOperation(
      currentRepo.operations.branchAction,
      operationsReadModel.data?.operations,
    )
    if (branchAction.phase !== 'idle' || worktreeBootstrap.loading) return false
    const result = await runBranchAction(
      repoId,
      { kind: 'createWorktree', input: request.input, worktreeBootstrap: currentWorktreeBootstrapDecision() },
      { repoRuntimeId: liveRepo.repoRuntimeId, refreshOnError: false },
    )
    if (result?.ok) onCreated(createWorktreeTargetBranch(request.input))
    return false
  }

  return (
    <CreateWorktreePageShell compact={compact} trafficLightOffset={trafficLightOffset} onBack={onCancel}>
      <ScrollPane>
        <CreateWorktreePageBody
          repo={{
            ...projectBranchActionRepo(liveRepo, operationsReadModel.data?.operations),
            branchModel: branchReadModel,
          }}
          worktreeBootstrap={worktreeBootstrap}
          onCancel={onCancel}
          onCreate={handleCreateWorktree}
        />
      </ScrollPane>
    </CreateWorktreePageShell>
  )
}

function CreateWorktreePageShell({
  compact,
  trafficLightOffset,
  onBack,
  children,
}: {
  compact: boolean
  trafficLightOffset: boolean
  onBack: () => void
  children: ReactNode
}) {
  const t = useT()
  return (
    <RepoPagePane
      icon={GitBranchPlus}
      label={t('action.create-worktree-title')}
      compact={compact}
      trafficLightOffset={trafficLightOffset}
      onBack={onBack}
    >
      {children}
    </RepoPagePane>
  )
}

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

function isBootstrapLoadForRepo(load: BootstrapLoad | null, repoId: string, repoRuntimeId: string): boolean {
  return load?.repoId === repoId && load.repoRuntimeId === repoRuntimeId
}

async function loadBootstrap(repoId: string, repoRuntimeId: string, signal: AbortSignal): Promise<BootstrapLoad> {
  const previewResult = await getRepoWorktreeBootstrapPreview(repoId, repoRuntimeId, signal).catch(
    (): WorktreeBootstrapPreviewResult => ({ ok: false, message: 'error.failed-read-repo' }),
  )
  let settingsSnapshot: SettingsSnapshot | undefined
  let settingsError = false

  if (previewResult.ok && previewResult.preview.hasOperations && previewResult.preview.configHash) {
    try {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      settingsSnapshot = await primaryWindowQueryClient.fetchQuery(settingsSnapshotQueryOptions({ signal }))
    } catch {
      settingsError = true
    }
  }

  return { repoId, repoRuntimeId, previewResult, settingsSnapshot, settingsError }
}
