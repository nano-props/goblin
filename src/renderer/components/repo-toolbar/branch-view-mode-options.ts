import type { BranchViewMode } from '#/renderer/stores/repos/types.ts'

export const BRANCH_VIEW_MODE_OPTIONS = [
  { id: 'all', labelKey: 'branches.filter.all', tooltipKey: 'branches.filter-tooltip.all' },
  { id: 'worktrees', labelKey: 'branches.filter.worktrees', tooltipKey: 'branches.filter-tooltip.worktrees' },
  {
    id: 'no-worktree',
    labelKey: 'branches.filter.no-worktree',
    tooltipKey: 'branches.filter-tooltip.no-worktree',
  },
] satisfies readonly { id: BranchViewMode; labelKey: string; tooltipKey: string }[]
