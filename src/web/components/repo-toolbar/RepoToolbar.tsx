// Chrome for the repo toolbar: the toolbar background/border, the
// right-side repo actions (sync, create worktree), and a children slot
// for whatever left-side content belongs to this view. Concrete left
// content lives in BranchInfoBar (focus mode) or BranchPaneToolbar
// (non-focus mode); this component intentionally knows nothing about
// workspace modes so callers can compose it without branching.
//
// Caller must guarantee `s.repos[repoId]` exists before mounting;
// see RepoView for the canonical gate.

import type { ReactNode } from 'react'
import { Toolbar } from '#/web/components/Layout.tsx'
import { RepoToolbarActions } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'

interface Props {
  repoId: string
  children?: ReactNode
}

export function RepoToolbar({ repoId, children }: Props) {
  return (
    <Toolbar variant="repo" className="justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        <RepoToolbarActions repoId={repoId} />
      </div>
    </Toolbar>
  )
}
