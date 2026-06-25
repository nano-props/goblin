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

import { useEffect } from 'react'
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

  // Force-close when the active repo changes. Without this a
  // half-typed branch name from repo A could leak into a submission
  // against repo B. Same contract as the previous per-repo trigger.
  //
  // `open` and `onOpenChange` are deliberately NOT in the dep array:
  //   - `open` would cause the effect to fire on the dialog's own
  //     false→true transition (when the user opens it) and
  //     immediately close it via `onOpenChange(false)`. The previous
  //     previous trigger implementation only depended on `repoId`.
  //   - `onOpenChange` is recreated every Layout render
  //     (`useAppOverlays` returns a fresh callback chain because
  //     `options = {}` is a fresh object each call); including it
  //     would re-fire the effect on every Layout re-render.
  useEffect(() => {
    if (open) onOpenChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

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
