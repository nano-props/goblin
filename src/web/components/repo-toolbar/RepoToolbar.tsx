// Chrome for the repo toolbar: the toolbar background/border, the
// right-side repo actions (sync, create worktree), and a children slot
// for whatever left-side content belongs to this view. Concrete left
// content lives in BranchInfoBar (focus mode) or BranchPaneToolbar
// (non-focus mode); this component intentionally knows nothing about
// workspace modes so callers can compose it without branching.
//
// Returns null when `s.repos[repoId]` is missing so the chrome is safe
// to mount unconditionally — callers do not need their own `exists`
// guard.

import type { ReactNode } from 'react'
import { Toolbar } from '#/web/components/Layout.tsx'
import { RepoToolbarActions } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'

interface Props {
  repoId: string
  children?: ReactNode
}

export function RepoToolbar({ repoId, children }: Props) {
  const exists = useReposStore((s) => !!s.repos[repoId])
  if (!exists) return null

  return (
    <Toolbar variant="repo" className="justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        <RepoToolbarActions repoId={repoId} />
      </div>
    </Toolbar>
  )
}
