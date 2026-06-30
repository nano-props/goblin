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
import { DialogHostMount } from '#/web/components/ui/dialog-host-mount.tsx'
import { useLastNonNull } from '#/web/hooks/useLastNonNull.ts'
import { getRepoWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { currentSettingsSnapshot } from '#/web/settings-read-projection.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoWorktreeBootstrapConfigTrusted } from '#/shared/repo-settings.ts'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
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
  const [rememberBootstrapTrust, setRememberBootstrapTrust] = useState(false)
  const settingsSnapshot = useCurrentSettingsSnapshot()

  function resetBootstrapPreflightState(): void {
    setBootstrapPreview(null)
    setBootstrapPreviewError(false)
    setBootstrapPreviewLoading(false)
    setRememberBootstrapTrust(false)
  }

  const repoId = liveRepo?.id ?? null
  const repoToken = liveRepo?.instanceToken ?? null

  useEffect(() => {
    if (!open || !repoId || repoToken === null) {
      resetBootstrapPreflightState()
      return
    }

    const controller = new AbortController()
    let ignore = false
    setBootstrapPreview(null)
    setBootstrapPreviewError(false)
    setBootstrapPreviewLoading(true)
    setRememberBootstrapTrust(false)

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
  }, [open, repoId, repoToken])

  if (!displayRepo) return null

  function submitCreateWorktree(
    repoId: string,
    token: number,
    request: CreateWorktreeRequest,
    worktreeBootstrap: WorktreeBootstrapDecision,
  ): boolean {
    const currentRepo = useReposStore.getState().repos[repoId]
    if (!currentRepo || currentRepo.instanceToken !== token) return false
    if (currentRepo.operations.branchAction.phase !== 'idle') return false
    submitBranchAction(
      repoId,
      { kind: 'createWorktree', input: request.input, worktreeBootstrap },
      { token, refreshOnError: false },
    )
    return true
  }

  function handleCreateWorktree(request: CreateWorktreeRequest): boolean {
    if (!liveRepo) return false
    if (liveRepo.operations.branchAction.phase !== 'idle' || bootstrapPreviewLoading) return false
    const repoId = liveRepo.id
    const token = liveRepo.instanceToken

    const worktreeBootstrap = resolveWorktreeBootstrapDecision(repoId)
    return submitCreateWorktree(repoId, token, request, worktreeBootstrap)
  }

  function resolveWorktreeBootstrapDecision(repoId: string): WorktreeBootstrapDecision {
    const configHash = bootstrapPreview?.hasOperations ? bootstrapPreview.configHash : null
    if (!configHash) return { kind: 'skip' }
    if (isCurrentBootstrapConfigTrusted(repoId, configHash)) return { kind: 'run', configHash, rememberTrust: false }
    return { kind: 'run', configHash, rememberTrust: rememberBootstrapTrust }
  }

  function isCurrentBootstrapConfigTrusted(repoId: string, configHash: string | null | undefined): boolean {
    return isRepoWorktreeBootstrapConfigTrusted(settingsSnapshot?.repoSettings ?? [], repoId, configHash)
  }

  const bootstrapConfigHash = bootstrapPreview?.configHash ?? null
  const bootstrapTrusted = isCurrentBootstrapConfigTrusted(displayRepo.id, bootstrapConfigHash)

  return (
    <CreateWorktreeDialog
      open={open}
      repo={displayRepo}
      worktreeBootstrap={{
        loading: bootstrapPreviewLoading,
        preview: bootstrapPreview,
        error: bootstrapPreviewError,
        trusted: bootstrapTrusted,
        rememberTrust: rememberBootstrapTrust,
        onRememberTrustChange: setRememberBootstrapTrust,
      }}
      onClose={() => onOpenChange(false)}
      onCreate={handleCreateWorktree}
    />
  )
}

function useCurrentSettingsSnapshot(): SettingsSnapshot | undefined {
  const [snapshot, setSnapshot] = useState(() => currentSettingsSnapshot())

  useEffect(() => {
    let disposed = false
    let queued = false

    function syncSnapshot(): void {
      if (disposed) return
      setSnapshot(currentSettingsSnapshot())
    }

    syncSnapshot()

    const unsubscribe = primaryWindowQueryClient.getQueryCache().subscribe(() => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        syncSnapshot()
      })
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  return snapshot
}
