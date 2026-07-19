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
  WorkspacePageLoadingBody,
  WorkspacePagePane,
  WorkspacePageQuietLoadingBody,
} from '#/web/components/workspace-pages/WorkspacePagePane.tsx'
import { useLoadingVisibility } from '#/web/hooks/useLoadingVisibility.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { getRepoWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { useRepoBranchReadModel } from '#/web/repo-branch-read-model.ts'
import { useRepoOperationsReadModel } from '#/web/repo-data-query.ts'
import { settingsSnapshotQueryOptions } from '#/web/settings-queries.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { projectBranchActionOperation, projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

type ConfigTrustChoice = { key: string; value: boolean } | null
type BootstrapLoad = {
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
  onCreated: (branchName: string) => void
}

export function CreateWorktreePagePane({
  repoId,
  compact = false,
  trafficLightOffset = false,
  onCancel,
  onCreated,
}: CreateWorktreePagePaneProps) {
  const liveRepo = useWorkspacesStore((s) => s.workspaces[repoId])
  const git = liveRepo?.capability.kind === 'git' ? liveRepo.capability.git : null
  const runBranchAction = useWorkspacesStore((s) => s.runBranchAction)
  const branchReadModel = useRepoBranchReadModel(liveRepo?.id ?? '', liveRepo?.workspaceRuntimeId ?? '', git !== null)
  const operationsReadModel = useRepoOperationsReadModel(liveRepo?.id ?? '', liveRepo?.workspaceRuntimeId ?? '', {
    enabled: git !== null,
  })
  const workspaceRuntimeId = liveRepo?.workspaceRuntimeId ?? null
  const [configTrustChoice, setConfigTrustChoice] = useState<ConfigTrustChoice>(null)
  const [bootstrapLoad, setBootstrapLoad] = useState<BootstrapLoad | null>(null)
  const [bootstrapLoading, setBootstrapLoading] = useState(false)

  useEffect(() => {
    if (workspaceRuntimeId === null) {
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

    void loadBootstrap(repoId, workspaceRuntimeId, controller.signal)
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
  }, [repoId, workspaceRuntimeId])

  const activeBootstrapLoad =
    workspaceRuntimeId && isBootstrapLoadForRepo(bootstrapLoad, repoId, workspaceRuntimeId) ? bootstrapLoad : null
  const bootstrapPreviewResult = activeBootstrapLoad?.previewResult
  const bootstrapPreview = bootstrapPreviewResult?.ok ? bootstrapPreviewResult.preview : null
  const bootstrapPreviewError = bootstrapPreviewResult?.ok === false
  const bootstrapConfigHash = bootstrapPreview?.configHash ?? null
  const bootstrapTrustKey = bootstrapConfigHash
    ? `${repoId}\u0000${workspaceRuntimeId ?? ''}\u0000${bootstrapConfigHash}`
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
  const pageReady = !!liveRepo && git !== null && !!branchReadModel && bootstrapDecisionReady
  const showLoadingSkeleton = useLoadingVisibility(!pageReady)
  const holdLoadingPage = !pageReady || showLoadingSkeleton

  if (holdLoadingPage) {
    return (
      <CreateWorktreePageShell compact={compact} trafficLightOffset={trafficLightOffset} onBack={onCancel}>
        {showLoadingSkeleton ? <WorkspacePageLoadingBody /> : <WorkspacePageQuietLoadingBody />}
      </CreateWorktreePageShell>
    )
  }

  const serverConfigTrusted = resolveConfigTrusted({
    workspaceSettings: settingsSnapshot?.workspaceSettings ?? [],
    workspaceId: repoId,
    configHash: bootstrapConfigHash,
    configTrustChoice: null,
  })
  const configTrusted = settingsSnapshot
    ? resolveConfigTrusted({
        workspaceSettings: settingsSnapshot.workspaceSettings,
        workspaceId: repoId,
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
      workspaceSettings: settingsSnapshot?.workspaceSettings ?? [],
      workspaceId: repoId,
      configTrustChoice: effectiveConfigTrustChoice,
    })
  }

  async function handleCreateWorktree(request: CreateWorktreeRequest): Promise<boolean> {
    const currentRepo = useWorkspacesStore.getState().workspaces[repoId]
    if (
      !currentRepo ||
      currentRepo.capability.kind !== 'git' ||
      currentRepo.workspaceRuntimeId !== liveRepo.workspaceRuntimeId
    )
      return false
    const branchAction = projectBranchActionOperation(
      currentRepo.capability.git.operations.branchAction,
      operationsReadModel.data?.operations,
    )
    if (branchAction.phase !== 'idle' || worktreeBootstrap.loading) return false
    const result = await runBranchAction(
      repoId,
      { kind: 'createWorktree', input: request.input, worktreeBootstrap: currentWorktreeBootstrapDecision() },
      { workspaceRuntimeId: liveRepo.workspaceRuntimeId, refreshOnError: false },
    )
    if (result?.ok) onCreated(createWorktreeTargetBranch(request.input))
    return false
  }

  return (
    <CreateWorktreePageShell compact={compact} trafficLightOffset={trafficLightOffset} onBack={onCancel}>
      <ScrollPane>
        <CreateWorktreePageBody
          repo={{
            ...projectBranchActionRepo(
              {
                id: liveRepo.id,
                workspaceRuntimeId: liveRepo.workspaceRuntimeId,
                operations: { branchAction: git.operations.branchAction },
                remote: git.remote,
                remoteLifecycle: liveRepo.admission.kind === 'remote' ? liveRepo.admission.lifecycle : null,
              },
              operationsReadModel.data?.operations,
            ),
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
    <WorkspacePagePane
      icon={GitBranchPlus}
      label={t('action.create-worktree-title')}
      compact={compact}
      trafficLightOffset={trafficLightOffset}
      onBack={onBack}
    >
      {children}
    </WorkspacePagePane>
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

function isBootstrapLoadForRepo(load: BootstrapLoad | null, repoId: WorkspaceId, workspaceRuntimeId: string): boolean {
  return load?.repoId === repoId && load.workspaceRuntimeId === workspaceRuntimeId
}

async function loadBootstrap(
  repoId: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
): Promise<BootstrapLoad> {
  const previewResult = await getRepoWorktreeBootstrapPreview(repoId, workspaceRuntimeId, signal).catch(
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

  return { repoId, workspaceRuntimeId, previewResult, settingsSnapshot, settingsError }
}
