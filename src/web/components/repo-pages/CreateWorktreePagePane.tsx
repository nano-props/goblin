import { useEffect, useState } from 'react'
import { GitBranchPlus } from 'lucide-react'
import { CreateWorktreePageSurface } from '#/web/components/create-worktree/CreateWorktreeSurface.tsx'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree/create-worktree.logic.ts'
import {
  isConfigTrustStateLoading,
  resolveConfigTrusted,
  resolveNextConfigTrustChoice,
  resolveWorktreeBootstrapDecision,
} from '#/web/components/create-worktree/create-worktree-bootstrap-host.logic.ts'
import { ScrollPane } from '#/web/components/Layout.tsx'
import { RepoPageToolbar } from '#/web/components/repo-pages/RepoPageToolbar.tsx'
import { getRepoWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { useRepoBranchReadModel } from '#/web/repo-branch-read-model.ts'
import { useSettingsSnapshotReadModel } from '#/web/settings-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'

interface CreateWorktreePagePaneProps {
  repoId: string
  trafficLightOffset?: boolean
  onCancel: () => void
  onCreated: (branchName: string) => void
}

export function CreateWorktreePagePane({ repoId, trafficLightOffset = false, onCancel, onCreated }: CreateWorktreePagePaneProps) {
  const t = useT()
  const liveRepo = useReposStore((s) => s.repos[repoId])
  const runBranchAction = useReposStore((s) => s.runBranchAction)
  const branchReadModel = useRepoBranchReadModel(liveRepo?.id ?? '', liveRepo?.instanceId ?? '', !!liveRepo)
  const [bootstrapPreview, setBootstrapPreview] = useState<WorktreeBootstrapPreview | null>(null)
  const [bootstrapPreviewError, setBootstrapPreviewError] = useState(false)
  const [bootstrapPreviewLoading, setBootstrapPreviewLoading] = useState(false)
  const [configTrustChoice, setConfigTrustChoice] = useState<boolean | null>(null)
  const settingsSnapshot = useSettingsSnapshotReadModel()

  const repoInstanceId = liveRepo?.instanceId ?? null

  useEffect(() => {
    if (!liveRepo || repoInstanceId === null) {
      setBootstrapPreview(null)
      setBootstrapPreviewError(false)
      setBootstrapPreviewLoading(false)
      setConfigTrustChoice(null)
      return
    }

    const controller = new AbortController()
    let ignore = false
    setBootstrapPreview(null)
    setBootstrapPreviewError(false)
    setBootstrapPreviewLoading(true)
    setConfigTrustChoice(null)

    void getRepoWorktreeBootstrapPreview(repoId, controller.signal)
      .then((result) => {
        if (ignore) return
        setBootstrapPreview(result.ok ? result.preview : null)
        setBootstrapPreviewError(!result.ok)
      })
      .catch(() => {
        if (ignore) return
        setBootstrapPreview(null)
        setBootstrapPreviewError(true)
      })
      .finally(() => {
        if (ignore) return
        setBootstrapPreviewLoading(false)
      })

    return () => {
      ignore = true
      controller.abort()
    }
  }, [liveRepo, repoId, repoInstanceId])

  if (!liveRepo || !branchReadModel) return null

  const bootstrapConfigHash = bootstrapPreview?.configHash ?? null
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
        configTrustChoice,
      })
    : false
  const worktreeBootstrapTrustLoading = isConfigTrustStateLoading({
    preview: bootstrapPreview,
    settingsReady: settingsSnapshot !== undefined,
  })
  const worktreeBootstrap = {
    loading: bootstrapPreviewLoading || worktreeBootstrapTrustLoading,
    preview: bootstrapPreview,
    error: bootstrapPreviewError,
    configTrusted,
    onConfigTrustedChange: (next: boolean) => {
      setConfigTrustChoice((currentChoice) =>
        resolveNextConfigTrustChoice({
          next,
          currentTrusted: configTrusted,
          serverTrusted: serverConfigTrusted,
          currentChoice,
        }),
      )
    },
  }

  function currentWorktreeBootstrapDecision(): WorktreeBootstrapDecision {
    return resolveWorktreeBootstrapDecision({
      preview: bootstrapPreview,
      repoSettings: settingsSnapshot?.repoSettings ?? [],
      repoId,
      configTrustChoice,
    })
  }

  async function handleCreateWorktree(request: CreateWorktreeRequest): Promise<boolean> {
    const currentRepo = useReposStore.getState().repos[repoId]
    if (!currentRepo || currentRepo.instanceId !== liveRepo.instanceId) return false
    if (currentRepo.operations.branchAction.phase !== 'idle' || worktreeBootstrap.loading) return false
    const result = await runBranchAction(
      repoId,
      { kind: 'createWorktree', input: request.input, worktreeBootstrap: currentWorktreeBootstrapDecision() },
      { repoInstanceId: liveRepo.instanceId, refreshOnError: false },
    )
    if (result?.ok) onCreated(createWorktreeTargetBranch(request.input))
    return false
  }

  return (
    <>
      <RepoPageToolbar icon={GitBranchPlus} label={t('action.create-worktree-title')} trafficLightOffset={trafficLightOffset} />
      <ScrollPane>
        <CreateWorktreePageSurface
          repo={{ ...liveRepo, branchModel: branchReadModel }}
          worktreeBootstrap={worktreeBootstrap}
          onCancel={onCancel}
          onCreate={handleCreateWorktree}
        />
      </ScrollPane>
    </>
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
