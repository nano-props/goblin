import type { BranchViewMode } from '#/web/stores/repos/types.ts'
export const BRANCH_VIEW_MODE_OPTIONS = [
  { id: 'all', labelKey: 'branches.filter.all', tooltipKey: 'branches.filter-tooltip.all' },
  { id: 'worktrees', labelKey: 'branches.filter.worktrees', tooltipKey: 'branches.filter-tooltip.worktrees' },
] satisfies readonly { id: BranchViewMode; labelKey: string; tooltipKey: string }[]
