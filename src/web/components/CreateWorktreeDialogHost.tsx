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
import {
  CreateWorktreeDialog,
  type WorktreeBootstrapChoice,
} from '#/web/components/create-worktree-dialog/CreateWorktreeDialog.tsx'
import type { CreateWorktreeRequest } from '#/web/components/create-worktree-dialog/create-worktree-dialog.logic.ts'
import { getRepositoryWorktreeBootstrapPreview } from '#/web/repo-client.ts'
import { currentSettingsSnapshot } from '#/web/settings-read-projection.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoWorktreeBootstrapConfigTrusted } from '#/shared/repo-settings.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreview } from '#/shared/worktree-bootstrap-summary.ts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeId: string | null
}

export function CreateWorktreeDialogHost({ open, onOpenChange, activeId }: Props) {
  const repo = useReposStore((s) => (activeId ? s.repos[activeId] : undefined))
  const submitBranchAction = useReposStore((s) => s.submitBranchAction)
  const [bootstrapPreview, setBootstrapPreview] = useState<WorktreeBootstrapPreview | null>(null)
  const [bootstrapPreviewLoading, setBootstrapPreviewLoading] = useState(false)
  const [bootstrapChoice, setBootstrapChoice] = useState<WorktreeBootstrapChoice>('skip')
  const previousActiveIdRef = useRef(activeId)

  function resetBootstrapPreflightState(): void {
    setBootstrapPreview(null)
    setBootstrapPreviewLoading(false)
    setBootstrapChoice('skip')
  }

  // Force-close when the active repo changes. Without this a
  // half-typed branch name from repo A could leak into a submission
  // against repo B. Same contract as the previous per-repo trigger.
  useEffect(() => {
    const previousActiveId = previousActiveIdRef.current
    previousActiveIdRef.current = activeId
    if (previousActiveId !== activeId) {
      resetBootstrapPreflightState()
      if (open) onOpenChange(false)
    }
  }, [activeId, onOpenChange, open])

  const repoId = repo?.id ?? null
  const repoToken = repo?.instanceToken ?? null

  useEffect(() => {
    if (!open || !repoId || repoToken === null) {
      resetBootstrapPreflightState()
      return
    }

    const controller = new AbortController()
    let ignore = false
    setBootstrapPreview(null)
    setBootstrapPreviewLoading(true)
    setBootstrapChoice('skip')

    void getRepositoryWorktreeBootstrapPreview(repoId, controller.signal)
      .then((result) => {
        if (ignore) return
        setBootstrapPreview(result.ok ? result.preview : null)
      })
      .catch(() => {
        if (ignore) return
        setBootstrapPreview(null)
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

  function handleCreateWorktree(request: CreateWorktreeRequest): boolean {
    // TypeScript narrows `repo` to non-null in the render body, but not inside
    // a nested function. The early return is a no-op at runtime because the
    // host already bails out above; it just satisfies the type checker.
    if (!repo) return false
    if (repo.operations.branchAction.phase !== 'idle' || bootstrapPreviewLoading) return false
    const repoId = repo.id
    const token = repo.instanceToken

    const worktreeBootstrap = resolveWorktreeBootstrapDecision(repoId)
    submitCreateWorktree(repoId, token, request, worktreeBootstrap)
    return true
  }

  function resolveWorktreeBootstrapDecision(repoId: string): WorktreeBootstrapDecision {
    const configHash = bootstrapPreview?.hasOperations ? bootstrapPreview.configHash : null
    if (!configHash) return { kind: 'skip' }
    if (isCurrentBootstrapConfigTrusted(repoId, configHash)) return { kind: 'run', configHash, rememberTrust: false }
    if (bootstrapChoice === 'run') return { kind: 'run', configHash, rememberTrust: false }
    if (bootstrapChoice === 'trust') return { kind: 'run', configHash, rememberTrust: true }
    return { kind: 'skip' }
  }

  function isCurrentBootstrapConfigTrusted(repoId: string, configHash: string | null | undefined): boolean {
    return isRepoWorktreeBootstrapConfigTrusted(currentSettingsSnapshot()?.repoSettings ?? [], repoId, configHash)
  }

  const bootstrapConfigHash = bootstrapPreview?.configHash ?? null
  const bootstrapTrusted = isCurrentBootstrapConfigTrusted(repo.id, bootstrapConfigHash)

  return (
    <CreateWorktreeDialog
      open={open}
      repo={repo}
      worktreeBootstrap={{
        loading: bootstrapPreviewLoading,
        preview: bootstrapPreview,
        trusted: bootstrapTrusted,
        choice: bootstrapChoice,
        onChoiceChange: setBootstrapChoice,
      }}
      onClose={() => onOpenChange(false)}
      onCreate={handleCreateWorktree}
    />
  )
}
