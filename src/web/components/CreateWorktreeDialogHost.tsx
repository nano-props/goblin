// Layout-level host for the create-worktree dialog. Mounted in
// `Layout.MainWindowOverlays` so it survives settings ⇄ workspace
// navigation. Source of truth is `useAppOverlays.createWorktree`
// (exposed via `LayoutOverlayActions`).
//
// Form state lives inside `CreateWorktreeDialog` itself and is
// therefore preserved across settings navigation — the user can
// type a branch name, click "Settings", read a config, come back,
// and the typed name is still there. Active repo switches still
// close the dialog to match the previous per-repo trigger behaviour.

import { useEffect, useRef, useState } from 'react'
import { CreateWorktreeDialog } from '#/web/components/create-worktree-dialog/CreateWorktreeDialog.tsx'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree-dialog/create-worktree-dialog.logic.ts'
import { WorktreeBootstrapConfirmDialog } from '#/web/components/WorktreeBootstrapConfirmDialog.tsx'
import { getRepositoryWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { currentSettingsSnapshot } from '#/web/settings-read-projection.ts'
import { rememberRepoWorktreeBootstrapConfig } from '#/web/settings-write-paths.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoWorktreeBootstrapConfigTrusted } from '#/shared/repo-settings.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeId: string | null
}

interface PendingBootstrapConfirm {
  repoId: string
  token: number
  request: CreateWorktreeRequest
  preview: WorktreeBootstrapPreview
}

export function CreateWorktreeDialogHost({ open, onOpenChange, activeId }: Props) {
  const repo = useReposStore((s) => (activeId ? s.repos[activeId] : undefined))
  const submitBranchAction = useReposStore((s) => s.submitBranchAction)
  const [pendingBootstrapConfirm, setPendingBootstrapConfirm] = useState<PendingBootstrapConfirm | null>(null)
  const [rememberBootstrapRun, setRememberBootstrapRun] = useState(false)
  const previousActiveIdRef = useRef(activeId)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  // Force-close when the active repo changes. Without this a
  // half-typed branch name from repo A could leak into a submission
  // against repo B. Same contract as the previous per-repo trigger.
  useEffect(() => {
    const previousActiveId = previousActiveIdRef.current
    previousActiveIdRef.current = activeId
    if (previousActiveId !== activeId) {
      setPendingBootstrapConfirm(null)
      setRememberBootstrapRun(false)
      if (open) onOpenChange(false)
    }
  }, [activeId, onOpenChange, open])

  if (!repo) return null

  function submitCreateWorktree(
    repoId: string,
    token: number,
    request: CreateWorktreeRequest,
    worktreeBootstrap: WorktreeBootstrapDecision,
  ): void {
    const currentRepo = useReposStore.getState().repos[repoId]
    if (!currentRepo || currentRepo.instanceToken !== token) return
    if (currentRepo.operations.branchAction.phase !== 'idle') return
    submitBranchAction(
      repoId,
      { kind: 'createWorktree', input: request.input, worktreeBootstrap },
      { token, refreshOnError: false },
    )
  }

  function handleCreateWorktree(request: CreateWorktreeRequest): void {
    // TypeScript narrows `repo` to non-null in the render body, but not inside
    // a nested function. The early return is a no-op at runtime because the
    // host already bails out above; it just satisfies the type checker.
    if (!repo) return
    if (repo.operations.branchAction.phase !== 'idle') return
    const repoId = repo.id
    const token = repo.instanceToken

    void getRepositoryWorktreeBootstrapPreview(repoId)
      .then((result) => {
        if (activeIdRef.current !== repoId) return
        const currentRepo = useReposStore.getState().repos[repoId]
        if (!currentRepo || currentRepo.instanceToken !== token) return
        if (result.ok && result.preview.hasOperations && result.preview.configHash) {
          if (
            isRepoWorktreeBootstrapConfigTrusted(
              currentSettingsSnapshot()?.repoSettings ?? [],
              repoId,
              result.preview.configHash,
            )
          ) {
            submitCreateWorktree(repoId, token, request, { kind: 'run', configHash: result.preview.configHash })
            return
          }
          setRememberBootstrapRun(false)
          setPendingBootstrapConfirm({ repoId, token, request, preview: result.preview })
          return
        }
        submitCreateWorktree(repoId, token, request, { kind: 'skip' })
      })
      .catch(() => {
        if (activeIdRef.current !== repoId) return
        submitCreateWorktree(repoId, token, request, { kind: 'skip' })
      })
  }

  function handleBootstrapRun(): void {
    const pending = pendingBootstrapConfirm
    if (!pending) return
    setPendingBootstrapConfirm(null)
    const configHash = pending.preview.configHash
    if (!configHash) {
      setRememberBootstrapRun(false)
      submitCreateWorktree(pending.repoId, pending.token, pending.request, { kind: 'skip' })
      return
    }
    if (rememberBootstrapRun) {
      void rememberRepoWorktreeBootstrapConfig(pending.repoId, configHash).catch(() => undefined)
    }
    setRememberBootstrapRun(false)
    submitCreateWorktree(pending.repoId, pending.token, pending.request, { kind: 'run', configHash })
  }

  function handleBootstrapSkip(): void {
    const pending = pendingBootstrapConfirm
    if (!pending) return
    setPendingBootstrapConfirm(null)
    setRememberBootstrapRun(false)
    submitCreateWorktree(pending.repoId, pending.token, pending.request, { kind: 'skip' })
  }

  function handleBootstrapCancel(): void {
    setPendingBootstrapConfirm(null)
    setRememberBootstrapRun(false)
  }

  return (
    <>
      <CreateWorktreeDialog
        open={open}
        repo={repo}
        onClose={() => onOpenChange(false)}
        onCreate={handleCreateWorktree}
      />
      <WorktreeBootstrapConfirmDialog
        open={!!pendingBootstrapConfirm}
        preview={pendingBootstrapConfirm?.preview ?? null}
        rememberRun={rememberBootstrapRun}
        onRememberRunChange={setRememberBootstrapRun}
        onCancel={handleBootstrapCancel}
        onRun={handleBootstrapRun}
        onSkip={handleBootstrapSkip}
      />
    </>
  )
}
