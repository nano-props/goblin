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

import { useEffect, useRef } from 'react'
import { CreateWorktreeDialog, type CreateWorktreeRequest } from '#/web/components/CreateWorktreeDialog.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeId: string | null
}

export function CreateWorktreeDialogHost({ open, onOpenChange, activeId }: Props) {
  const repo = useReposStore((s) => (activeId ? s.repos[activeId] : undefined))
  const submitBranchAction = useReposStore((s) => s.submitBranchAction)
  const previousActiveIdRef = useRef(activeId)

  // Force-close when the active repo changes. Without this a
  // half-typed branch name from repo A could leak into a submission
  // against repo B. Same contract as the previous per-repo trigger.
  useEffect(() => {
    const previousActiveId = previousActiveIdRef.current
    previousActiveIdRef.current = activeId
    if (previousActiveId !== activeId && open) onOpenChange(false)
  }, [activeId, onOpenChange, open])

  if (!repo) return null

  function handleCreateWorktree(request: CreateWorktreeRequest): void {
    if (!repo) return
    if (repo.operations.branchAction.phase !== 'idle') return
    submitBranchAction(
      repo.id,
      { kind: 'createWorktree', input: request.input },
      { token: repo.instanceToken, refreshOnError: false },
    )
  }

  return (
    <CreateWorktreeDialog open={open} repo={repo} onClose={() => onOpenChange(false)} onCreate={handleCreateWorktree} />
  )
}
