// Layout-level host for the create-worktree dialog. Mounted in
// `Layout.PrimaryWindowOverlays` so it survives settings ⇄ workspace
// navigation. Source of truth is `useAppOverlays.createWorktree`
// (exposed via `LayoutOverlayActions`).
//
// Form state lives inside `CreateWorktreeDialog` itself and is
// therefore preserved across settings navigation — the user can
// type a branch name, click "Settings", read a config, come back,
// and the typed name is still there. The overlay state captures the
// repo id when the dialog opens so this host is bound to one dialog
// session rather than the live active repo. The session retains the
// last live repo snapshot for closed-state rendering only; submission
// and preflight still require a live repo in `useReposStore`.

import { useEffect, useState } from 'react'
import { CreateWorktreeDialog } from '#/web/components/create-worktree-dialog/CreateWorktreeDialog.tsx'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree-dialog/create-worktree-dialog.logic.ts'
import {
  isConfigTrustStateLoading,
  resolveConfigTrusted,
  resolveNextConfigTrustChoice,
  resolveWorktreeBootstrapDecision,
} from '#/web/components/create-worktree-dialog/create-worktree-bootstrap-host.logic.ts'
import { DialogHostMount } from '#/web/components/ui/dialog-host-mount.tsx'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'
import { getRepoWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { useSettingsSnapshotReadModel } from '#/web/settings-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: string | null
}

export function CreateWorktreeDialogHost({ open, onOpenChange, repoId }: Props) {
  return (
    <DialogHostMount target={repoId}>
      {(mountedRepoId) => (
        <CreateWorktreeDialogSession
          key={mountedRepoId}
          open={open}
          onOpenChange={onOpenChange}
          repoId={mountedRepoId}
        />
      )}
    </DialogHostMount>
  )
}

function CreateWorktreeDialogSession({ open, onOpenChange, repoId: sessionRepoId }: Props) {
  const liveRepo = useReposStore((s) => (sessionRepoId ? s.repos[sessionRepoId] : undefined))
  const displayRepo = useLastNonNull(liveRepo ?? null)
  const submitBranchAction = useReposStore((s) => s.submitBranchAction)
  const [bootstrapPreview, setBootstrapPreview] = useState<WorktreeBootstrapPreview | null>(null)
  const [bootstrapPreviewError, setBootstrapPreviewError] = useState(false)
  const [bootstrapPreviewLoading, setBootstrapPreviewLoading] = useState(false)
  const [configTrustChoice, setConfigTrustChoice] = useState<boolean | null>(null)
  const settingsSnapshot = useSettingsSnapshotReadModel()

  function resetBootstrapPreflightState(): void {
    setBootstrapPreview(null)
    setBootstrapPreviewError(false)
    setBootstrapPreviewLoading(false)
    setConfigTrustChoice(null)
  }

  const repoId = liveRepo?.id ?? null
  const repoInstanceId = liveRepo?.instanceId ?? null

  useEffect(() => {
    if (!open || !repoId || repoInstanceId === null) {
      resetBootstrapPreflightState()
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
  }, [open, repoId, repoInstanceId])

  const displayRepoId = displayRepo?.id ?? ''

  function submitCreateWorktree(
    repoId: string,
    repoInstanceId: string,
    request: CreateWorktreeRequest,
    worktreeBootstrap: WorktreeBootstrapDecision,
  ): boolean {
    const currentRepo = useReposStore.getState().repos[repoId]
    if (!currentRepo || currentRepo.instanceId !== repoInstanceId) return false
    if (currentRepo.operations.branchAction.phase !== 'idle') return false
    submitBranchAction(
      repoId,
      { kind: 'createWorktree', input: request.input, worktreeBootstrap },
      { repoInstanceId, refreshOnError: false },
    )
    return true
  }

  function handleCreateWorktree(request: CreateWorktreeRequest): boolean {
    if (!liveRepo) return false
    if (liveRepo.operations.branchAction.phase !== 'idle' || bootstrapPreviewLoading || worktreeBootstrapTrustLoading) {
      return false
    }
    const repoId = liveRepo.id
    const repoInstanceId = liveRepo.instanceId

    const worktreeBootstrap = currentWorktreeBootstrapDecision(repoId)
    return submitCreateWorktree(repoId, repoInstanceId, request, worktreeBootstrap)
  }

  function currentWorktreeBootstrapDecision(repoId: string): WorktreeBootstrapDecision {
    return resolveWorktreeBootstrapDecision({
      preview: bootstrapPreview,
      repoSettings: settingsSnapshot?.repoSettings ?? [],
      repoId,
      configTrustChoice,
    })
  }

  const bootstrapConfigHash = bootstrapPreview?.configHash ?? null
  const serverConfigTrusted = resolveConfigTrusted({
    repoSettings: settingsSnapshot?.repoSettings ?? [],
    repoId: displayRepoId,
    configHash: bootstrapConfigHash,
    configTrustChoice: null,
  })
  const configTrusted = settingsSnapshot
    ? resolveConfigTrusted({
        repoSettings: settingsSnapshot.repoSettings,
        repoId: displayRepoId,
        configHash: bootstrapConfigHash,
        configTrustChoice,
      })
    : false

  function handleConfigTrustedChange(next: boolean): void {
    setConfigTrustChoice((currentChoice) =>
      resolveNextConfigTrustChoice({
        next,
        currentTrusted: configTrusted,
        serverTrusted: serverConfigTrusted,
        currentChoice,
      }),
    )
  }

  const worktreeBootstrapTrustLoading = isConfigTrustStateLoading({
    preview: bootstrapPreview,
    settingsReady: settingsSnapshot !== undefined,
  })
  const worktreeBootstrapLoading = bootstrapPreviewLoading || worktreeBootstrapTrustLoading
  const worktreeBootstrap = {
    loading: worktreeBootstrapLoading,
    preview: bootstrapPreview,
    error: bootstrapPreviewError,
    configTrusted,
    onConfigTrustedChange: handleConfigTrustedChange,
  }
  // The effect above clears bootstrap state as soon as `open` becomes false.
  // That keeps the next open session from inheriting stale preflight data, but
  // Radix keeps dialog content mounted briefly for close motion. Retain the last
  // open display state at this host boundary so body-only regions do not vanish
  // mid-fade while the underlying business state is already reset.
  //
  // This is the same display-retention pattern used by branch action dialogs,
  // not a height/CSS workaround. If CreateWorktreeDialog gains more
  // close-sensitive dynamic regions, consolidate this into a dedicated
  // `useCreateWorktreeDialogDisplayState` helper instead of adding one-off
  // retained props here.
  const displayWorktreeBootstrap = useLastNonNull(open ? worktreeBootstrap : null)
  if (!displayRepo) return null

  return (
    <CreateWorktreeDialog
      open={open}
      repo={displayRepo}
      worktreeBootstrap={displayWorktreeBootstrap ?? undefined}
      onClose={() => onOpenChange(false)}
      onCreate={handleCreateWorktree}
    />
  )
}
