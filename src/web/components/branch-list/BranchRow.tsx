import { type CSSProperties, type HTMLAttributes, type RefObject, useCallback } from 'react'
import { GripVertical } from 'lucide-react'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { BranchActionsMenu } from '#/web/components/BranchActionsMenu.tsx'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import { cn } from '#/web/lib/cn.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'

interface BranchRowDragHandle {
  label: string
  ref: (node: HTMLButtonElement | null) => void
  props: HTMLAttributes<HTMLButtonElement>
}

interface BranchRowSortable {
  setNodeRef: (node: HTMLLIElement | null) => void
  style?: CSSProperties
  isDragging?: boolean
}

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
  dragHandle?: BranchRowDragHandle
  sortable?: BranchRowSortable
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
  dragHandle,
  sortable,
}: BranchRowProps) {
  const isSelected = branch.name === selected
  const setItemRef = useCallback(
    (node: HTMLLIElement | null) => {
      if (isSelected) {
        ;(selectedRef as { current: HTMLLIElement | null }).current = node
      }
      sortable?.setNodeRef(node)
    },
    [isSelected, selectedRef, sortable],
  )

  return (
    <li
      ref={sortable || isSelected ? setItemRef : undefined}
      style={sortable?.style}
      onClick={() => onSelectBranch(branch.name)}
      onDoubleClick={() => onOpenBranchStatus(branch.name)}
      className={cn(
        'relative grid min-h-9 items-stretch cursor-pointer',
        dragHandle
          ? showActions
            ? 'grid-cols-[2rem_minmax(0,1fr)_auto]'
            : 'grid-cols-[2rem_minmax(0,1fr)]'
          : showActions
            ? 'grid-cols-[minmax(0,1fr)_auto]'
            : 'grid-cols-1',
        'transition-colors duration-100',
        isSelected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
        sortable?.isDragging && 'z-10 bg-card text-foreground shadow-sm',
      )}
    >
      {dragHandle && (
        <div className="relative z-20 flex items-center justify-center py-1.5 pl-2">
          <button
            ref={dragHandle.ref}
            type="button"
            {...dragHandle.props}
            aria-label={dragHandle.label}
            title={dragHandle.label}
            onClick={(event) => {
              event.stopPropagation()
              dragHandle.props.onClick?.(event)
            }}
            onDoubleClick={(event) => {
              event.stopPropagation()
              dragHandle.props.onDoubleClick?.(event)
            }}
            className={cn(
              'flex size-6 touch-none cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground active:cursor-grabbing',
              dragHandle.props.className,
            )}
          >
            <GripVertical size={14} />
          </button>
        </div>
      )}
      <div className="pointer-events-none relative z-10 min-w-0 px-4 py-1.5">
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
