import { type RefObject } from 'react'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { BranchActionsMenu } from '#/web/components/BranchActionsMenu.tsx'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import { cn } from '#/web/lib/cn.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
interface BranchRowProps {
  repo: BranchActionRepo
  branch: RepoBranchState
  selected: string | null
  onSelectBranch: (branch: string) => void
  onOpenBranchStatus: (branch: string) => void
  selectedRef: RefObject<HTMLLIElement | null>
  showActions?: boolean
  actionMenuOpen?: boolean
  onActionMenuOpenChange?: (open: boolean) => void
}

export function BranchRow({
  repo,
  branch,
  selected,
  onSelectBranch,
  onOpenBranchStatus,
  selectedRef,
  showActions = true,
  actionMenuOpen,
  onActionMenuOpenChange,
}: BranchRowProps) {
  const isSelected = branch.name === selected

  return (
    <li
      ref={isSelected ? selectedRef : undefined}
      onClick={() => onSelectBranch(branch.name)}
      onDoubleClick={() => onOpenBranchStatus(branch.name)}
      className={cn(
        'relative grid min-h-9 items-stretch cursor-pointer rounded-md',
        showActions ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-1',
        'transition-colors duration-100',
        isSelected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
      )}
    >
      <div className="pointer-events-none relative z-10 flex min-w-0 items-center px-4 py-1.5">
        <BranchSummaryInline repo={repo} branch={branch} selected={isSelected} />
      </div>
      {showActions && (
        <div className="pointer-events-none relative z-20 flex shrink-0 items-center py-1.5 pr-4">
          <div className="pointer-events-auto">
            <BranchActionsMenu
              repo={repo}
              branch={branch}
              open={actionMenuOpen}
              onOpenChange={onActionMenuOpenChange}
            />
          </div>
        </div>
      )}
    </li>
  )
}
