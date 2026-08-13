// Pure presentational navigator list. Renders the ordered branch/worktree
// row model and scrolls the highlighted row into view as
// it changes. The wrapper (BranchNavigator pane) owns the data source,
// the navigation glue, and the outer container
// — this component owns the per-list action-menu state and the
// scroll-into-view side effect.
//
// Notes on the abstraction boundary:
//   • does NOT read the store; receives `repo` and ordered `rows` from the parent
//   • does NOT wrap in ScrollArea (the pane owns its scroll container)
//   • owns the per-list `actionMenuOpen` so the "row is no longer rendered
//     ⇒ close the menu" invariant lives next to the rows that draw it
//   • scrolls the highlighted row after Vue has committed the row ref
//   • the highlight comes from route context through the data wrapper

import { defineComponent, ref, watch } from 'vue'
import type { PropType, VNodeChild } from 'vue'
import { BranchListRow } from '#/web/components/branch-navigator/BranchListRow.tsx'
import type { BranchNavigatorRepo } from '#/web/components/branch-navigator/use-branch-navigator-data.ts'
import { WorktreeStateRow } from '#/web/components/branch-navigator/WorktreeStateRow.tsx'
import { BRANCH_ROW_LIST_CLASS } from '#/web/components/branch-navigator/branch-row-metrics.ts'
import type { BranchNavigatorRow } from '#/web/components/branch-navigator/branch-navigator-model.ts'

interface Props {
  /** May be null while repo data is not loaded yet; the list falls
   *  through to the empty-state slot in that case. */
  repo: BranchNavigatorRepo | null
  rows: BranchNavigatorRow[]
  /** Name of the branch to mark as selected/highlighted in the list. */
  highlightedBranch: string | null
  highlightedWorktreePath?: string | null
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  onSelectWorktree?: (worktreePath: string) => void
  onOpenWorktreeStatus?: (worktreePath: string) => void
  /** Rendered when `rows` is empty. */
  emptyState: VNodeChild
}

export const BranchNavigatorList = defineComponent<Props>({
  name: 'BranchNavigatorList',
  props: {
    repo: { type: Object as PropType<BranchNavigatorRepo | null>, default: null },
    rows: { type: Array as PropType<BranchNavigatorRow[]>, required: true },
    highlightedBranch: { type: String, default: null },
    highlightedWorktreePath: { type: String, default: null },
    onSelectBranch: { type: Function as PropType<(branch: string) => void>, required: true },
    onOpenBranchStatus: { type: Function as PropType<(branch: string) => void>, required: true },
    onSelectWorktree: Function as PropType<(worktreePath: string) => void>,
    onOpenWorktreeStatus: Function as PropType<(worktreePath: string) => void>,
    emptyState: { type: null, required: true },
  },

  setup(props) {
    const actionMenuOpen = ref<string | null>(null)
    const selectedRef = ref<HTMLLIElement | null>(null)

    // The menu owns an anchored overlay, so its state must end with the row.
    watch(
      () => props.rows,
      (rows) => {
        if (
          actionMenuOpen.value &&
          !rows.some(
            (row) =>
              row.branch?.name === actionMenuOpen.value &&
              (row.kind === 'branch' || (row.worktree.head.kind === 'branch' && row.worktree.operation === null)),
          )
        ) {
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
      if (props.rows.length === 0 || !props.repo) {
        return <>{props.emptyState}</>
      }

      return (
        <ul class={BRANCH_ROW_LIST_CLASS}>
          {props.rows.map((row) => {
            if (row.kind === 'worktree' && (row.worktree.head.kind === 'detached' || row.worktree.operation)) {
              return (
                <WorktreeStateRow
                  key={row.worktree.path}
                  workspaceId={props.repo!.id}
                  worktree={row.worktree}
                  selected={props.highlightedWorktreePath === row.worktree.path}
                  selectedRef={selectedRef}
                  onSelect={() => props.onSelectWorktree?.(row.worktree.path)}
                  onOpenStatus={() => props.onOpenWorktreeStatus?.(row.worktree.path)}
                />
              )
            }

            const branch = row.branch
            if (!branch) return null
            const worktreePath = row.kind === 'worktree' ? row.worktree.path : null
            const selected = worktreePath
              ? props.highlightedWorktreePath === worktreePath
                ? branch.name
                : null
              : props.highlightedBranch
            return (
              <BranchListRow
                key={row.kind === 'worktree' ? row.worktree.path : branch.name}
                repo={props.repo!}
                branch={branch}
                selected={selected}
                onSelectBranch={worktreePath ? () => props.onSelectWorktree?.(worktreePath) : props.onSelectBranch}
                onOpenBranchStatus={
                  worktreePath ? () => props.onOpenWorktreeStatus?.(worktreePath) : props.onOpenBranchStatus
                }
                selectedRef={selectedRef}
                actionMenuOpen={actionMenuOpen.value === branch.name}
                onActionMenuOpenChange={(open) => {
                  actionMenuOpen.value = open ? branch.name : null
                }}
              />
            )
          })}
        </ul>
      )
    }
  },
})
