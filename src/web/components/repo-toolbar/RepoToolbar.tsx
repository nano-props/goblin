// Chrome for the per-repo toolbar. Wraps `Toolbar variant="repo"`
// and provides a left/right layout: callers pass `children` for
// the left slot and `right` for the right slot. The per-repo
// actions (Refresh, worktree filter, new worktree) used to be
// auto-rendered in the right slot — they moved up to the Topbar
// (see `Topbar.tsx` and `App.tsx`), so this component is now a
// pure layout helper.
//
// Concrete left content:
//   • `BranchInfoBar` renders the focus-mode branch summary,
//     HEAD label, and branch actions.
//   • (no other current consumers; the non-focus mode dropped
//     its own toolbar when the actions moved to the topbar.)
//
// Caller must guarantee `s.repos[repoId]` exists before mounting;
// see RepoView for the canonical gate.

import type { ReactNode } from 'react'
import { Toolbar } from '#/web/components/Layout.tsx'

interface Props {
  children?: ReactNode
  /** Right-slot content. The Topbar now owns the per-repo
   * actions, so most callers leave this empty. */
  right?: ReactNode
}

export function RepoToolbar({ children, right }: Props) {
  return (
    <Toolbar variant="repo" className="justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </Toolbar>
  )
}
