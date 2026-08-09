// Pure presentational branch list. Renders a vertical list of
// BranchListRow entries and scrolls the highlighted row into view as
// it changes. The wrapper (BranchNavigator pane) owns the data source,
// the navigation glue, and the outer container
// — this component owns the per-list action-menu state and the
// scroll-into-view side effect.
//
// Notes on the abstraction boundary:
//   • does NOT read the store; receives `repo` and `branches` from the parent
//   • does NOT wrap in ScrollArea (the pane owns its scroll container)
//   • owns the per-list `actionMenuOpen` so the "row is no longer rendered
//     ⇒ close the menu" invariant lives next to the rows that draw it
//   • scrolls the highlighted row after Vue has committed the row ref
//   • the highlight comes from route context through the data wrapper

import { defineComponent, ref, watch } from 'vue'
import type { PropType, VNodeChild } from 'vue'
import { BranchListRow } from '#/web/components/branch-navigator/BranchListRow.tsx'
import type { BranchListRepo } from '#/web/components/branch-navigator/use-branch-list-data.ts'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { BRANCH_ROW_LIST_CLASS } from '#/web/components/branch-navigator/branch-row-metrics.ts'

interface Props {
  /** May be null while repo data is not loaded yet; the list falls
   *  through to the empty-state slot in that case. */
  repo: BranchListRepo | null
  branches: BranchSnapshotInfo[]
  /** Name of the branch to mark as selected/highlighted in the list. */
  highlightedBranch: string | null
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  /** Rendered when `branches` is empty. */
  emptyState: VNodeChild
}

export const BranchList = defineComponent<Props>({
  name: 'BranchList',
  props: {
    repo: { type: Object as PropType<BranchListRepo | null>, default: null },
    branches: { type: Array as PropType<BranchSnapshotInfo[]>, required: true },
    highlightedBranch: { type: String, default: null },
    onSelectBranch: { type: Function as PropType<(branch: string) => void>, required: true },
    onOpenBranchStatus: { type: Function as PropType<(branch: string) => void>, required: true },
    emptyState: { type: null, required: true },
  },

  setup(props) {
    const actionMenuOpen = ref<string | null>(null)
    const selectedRef = ref<HTMLLIElement | null>(null)

    // The menu owns an anchored overlay, so its state must end with the row.
    watch(
      () => props.branches,
      (branches) => {
        if (actionMenuOpen.value && !branches.some((branch) => branch.name === actionMenuOpen.value)) {
          actionMenuOpen.value = null
        }
      },
    )

    // The selected row ref is the DOM-readiness boundary for both initial mount
    // and route selection changes.
    watch(
      [selectedRef, () => props.highlightedBranch],
      () => selectedRef.value?.scrollIntoView?.({ block: 'nearest' }),
      { flush: 'post' },
    )

    return () => {
      if (props.branches.length === 0 || !props.repo) return <>{props.emptyState}</>

      return (
        <ul class={BRANCH_ROW_LIST_CLASS}>
          {props.branches.map((branch) => (
            <BranchListRow
              key={branch.name}
              repo={props.repo!}
              branch={branch}
              selected={props.highlightedBranch}
              onSelectBranch={props.onSelectBranch}
              onOpenBranchStatus={props.onOpenBranchStatus}
              selectedRef={selectedRef}
              actionMenuOpen={actionMenuOpen.value === branch.name}
              onActionMenuOpenChange={(open) => {
                actionMenuOpen.value = open ? branch.name : null
              }}
            />
          ))}
        </ul>
      )
    }
  },
})
