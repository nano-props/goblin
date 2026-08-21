import { defineComponent, ref, watch } from 'vue'
import type { PropType, VNodeChild } from 'vue'
import { GitWorkspaceNavigatorBranchRow } from '#/web/components/workspace-navigator/GitWorkspaceNavigatorBranchRow.tsx'
import type { GitWorkspaceNavigatorRepo } from '#/web/components/workspace-navigator/use-git-workspace-navigator-data.ts'
import { WorktreeStateRow } from '#/web/components/workspace-navigator/WorktreeStateRow.tsx'
import { NAVIGATOR_ROW_LIST_CLASS } from '#/web/components/workspace-navigator/navigator-row-metrics.ts'
import type { GitWorkspaceNavigatorRow } from '#/web/components/workspace-navigator/git-workspace-navigator-model.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

type NavigatorActionMenuTarget = { kind: 'branch' | 'worktree'; identity: string }

interface Props {
  repo: GitWorkspaceNavigatorRepo | null
  rows: GitWorkspaceNavigatorRow[]
  highlightedBranch: string | null
  highlightedWorktreePath?: string | null
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  onSelectWorktree?: (worktreePath: string) => void
  onOpenWorktreeStatus?: (worktreePath: string) => void
  onOpenWorktreeTab?: (worktreePath: string, type: WorkspacePaneStaticTabType) => void
  emptyState: VNodeChild
}

export const GitWorkspaceNavigatorList = defineComponent<Props>({
  name: 'GitWorkspaceNavigatorList',
  props: {
    repo: { type: Object as PropType<GitWorkspaceNavigatorRepo | null>, default: null },
    rows: { type: Array as PropType<GitWorkspaceNavigatorRow[]>, required: true },
    highlightedBranch: { type: String, default: null },
    highlightedWorktreePath: { type: String, default: null },
    onSelectBranch: { type: Function as PropType<(branch: string) => void>, required: true },
    onOpenBranchStatus: { type: Function as PropType<(branch: string) => void>, required: true },
    onSelectWorktree: Function as PropType<(worktreePath: string) => void>,
    onOpenWorktreeStatus: Function as PropType<(worktreePath: string) => void>,
    onOpenWorktreeTab: Function as PropType<(worktreePath: string, type: WorkspacePaneStaticTabType) => void>,
    emptyState: { type: null, required: true },
  },

  setup(props) {
    const actionMenuOpen = ref<NavigatorActionMenuTarget | null>(null)
    const selectedRef = ref<HTMLLIElement | null>(null)

    // The menu owns an anchored overlay, so its state must end with the row.
    watch(
      () => props.rows,
      (rows) => {
        const openMenu = actionMenuOpen.value
        if (openMenu && !rows.some((row) => navigatorRowOwnsActionMenu(row, openMenu))) {
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
      const repo = props.repo
      if (props.rows.length === 0 || !repo) {
        return <>{props.emptyState}</>
      }

      return (
        <ul class={NAVIGATOR_ROW_LIST_CLASS}>
          {props.rows.map((row) => {
            if (row.kind === 'worktree' && (row.branch === null || row.worktree.operation)) {
              return (
                <WorktreeStateRow
                  key={row.worktree.path}
                  workspaceId={repo.id}
                  worktree={row.worktree}
                  selected={props.highlightedWorktreePath === row.worktree.path}
                  selectedRef={selectedRef}
                  onSelect={() => props.onSelectWorktree?.(row.worktree.path)}
                  onOpenStatus={() => props.onOpenWorktreeStatus?.(row.worktree.path)}
                  onOpenTab={(type) => props.onOpenWorktreeTab?.(row.worktree.path, type)}
                  actionMenuOpen={
                    actionMenuOpen.value?.kind === 'worktree' && actionMenuOpen.value.identity === row.worktree.path
                  }
                  onActionMenuOpenChange={(open) => {
                    actionMenuOpen.value = open ? { kind: 'worktree', identity: row.worktree.path } : null
                  }}
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
              <GitWorkspaceNavigatorBranchRow
                key={row.kind === 'worktree' ? row.worktree.path : branch.name}
                repo={repo}
                branch={branch}
                selected={selected}
                onSelectBranch={worktreePath ? () => props.onSelectWorktree?.(worktreePath) : props.onSelectBranch}
                onOpenBranchStatus={props.onOpenBranchStatus}
                selectedRef={selectedRef}
                actionMenuOpen={
                  actionMenuOpen.value?.kind === 'branch' && actionMenuOpen.value.identity === branch.name
                }
                onActionMenuOpenChange={(open) => {
                  actionMenuOpen.value = open ? { kind: 'branch', identity: branch.name } : null
                }}
              />
            )
          })}
        </ul>
      )
    }
  },
})

function navigatorRowOwnsActionMenu(row: GitWorkspaceNavigatorRow, target: NavigatorActionMenuTarget): boolean {
  if (target.kind === 'branch') {
    return (
      row.branch?.name === target.identity &&
      (row.kind === 'branch' || (row.worktree.head.kind === 'branch' && row.worktree.operation === null))
    )
  }
  return (
    row.kind === 'worktree' &&
    row.worktree.path === target.identity &&
    (row.branch === null || row.worktree.operation !== null)
  )
}
