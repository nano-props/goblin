// Pure presentational branch list. Renders a vertical list of
// BranchListRow entries and scrolls the highlighted row into view as
// it changes. The wrapper (BranchNavigator pane / BranchListPopover)
// owns the data source, the navigation glue, and the outer container
// — this component owns the per-list action-menu state and the
// scroll-into-view side effect.
//
// Notes on the abstraction boundary:
//   • does NOT read the store; receives `repo` and `branches` from the parent
//   • does NOT wrap in ScrollArea (pane and popover both own their own ScrollArea)
//   • owns the per-list `actionMenuOpen` so the "row is no longer rendered
//     ⇒ close the menu" invariant lives next to the rows that draw it
//   • uses useLayoutEffect to scroll the highlighted row into view
//     before paint, so the popover / pane doesn't flash to the top first
//   • the highlight is the same single store field (`ui.selectedBranch`)
//     in both surfaces; both callers pass it down identically

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BranchListRow } from '#/web/components/branch-navigator/BranchListRow.tsx'
import type { BranchListRepo } from '#/web/components/branch-navigator/use-branch-list-data.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

interface Props {
  /** May be null when the popover's repo isn't loaded yet; the list
   *  falls through to the empty-state slot in that case. */
  repo: BranchListRepo | null
  branches: RepoBranchState[]
  /** Name of the branch to mark as selected/highlighted in the list.
   *  Both the persistent pane and the focus-mode popover pass the same
   *  `ui.selectedBranch` field from the same store, so the two surfaces
   *  stay in lockstep without any per-surface resolver. */
  highlightedBranch: string | null
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  showActions?: boolean
  /** Rendered when `branches` is empty. */
  emptyState: ReactNode
}

export function BranchList({
  repo,
  branches,
  highlightedBranch,
  onSelectBranch,
  onOpenBranchStatus,
  showActions = true,
  emptyState,
}: Props) {
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null)
  const selectedRef = useRef<HTMLLIElement | null>(null)

  // Reset the open action menu when its row is no longer rendered
  // (filter change, view-mode change, branch removed). Keeps the
  // popover state from outliving its anchor. Pure state update,
  // not a layout effect.
  useEffect(() => {
    if (!actionMenuOpen) return
    if (!branches.some((branch) => branch.name === actionMenuOpen)) {
      setActionMenuOpen(null)
    }
  }, [actionMenuOpen, branches])

  // Keep the highlighted row in view as the user navigates with j/k
  // (pane) or as the popover opens to a long branch list. useLayoutEffect
  // runs before paint so the popover / pane never flashes to the top.
  useLayoutEffect(() => {
    const selectedEl = selectedRef.current
    // jsdom doesn't implement scrollIntoView; the production DOM does.
    if (selectedEl && typeof selectedEl.scrollIntoView === 'function') {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedBranch])

  if (branches.length === 0 || !repo) return <>{emptyState}</>

  return (
    <ul className="flex min-w-0 flex-col gap-1 p-1.5">
      {branches.map((branch) => (
        <BranchListRow
          key={branch.name}
          repo={repo}
          branch={branch}
          selected={highlightedBranch}
          onSelectBranch={onSelectBranch}
          onOpenBranchStatus={onOpenBranchStatus}
          selectedRef={selectedRef}
          showActions={showActions}
          actionMenuOpen={actionMenuOpen === branch.name}
          onActionMenuOpenChange={(open) => setActionMenuOpen(open ? branch.name : null)}
        />
      ))}
    </ul>
  )
}