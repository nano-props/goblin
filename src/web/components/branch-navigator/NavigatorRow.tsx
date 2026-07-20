import type { ComponentProps, ReactNode, Ref } from 'react'
import {
  BRANCH_ROW_ACTION_SLOT_CLASS,
  BRANCH_ROW_CONTENT_CLASS,
  BRANCH_ROW_GRID_CLASS,
} from '#/web/components/branch-navigator/branch-row-metrics.ts'
import { cn } from '#/web/lib/cn.ts'

interface NavigatorRowProps extends Omit<ComponentProps<'li'>, 'children' | 'content'> {
  selected: boolean
  content: ReactNode
  actions: ReactNode
  rowRef?: Ref<HTMLLIElement>
  contentClassName?: string
}

export function NavigatorRow({
  selected,
  content,
  actions,
  rowRef,
  contentClassName,
  className,
  ...props
}: NavigatorRowProps) {
  return (
    <li
      ref={rowRef}
      className={cn(
        BRANCH_ROW_GRID_CLASS,
        'group relative cursor-pointer transition-colors duration-100',
        selected ? 'bg-selected text-selected-foreground hover:bg-selected' : 'hover:bg-muted',
        className,
      )}
      {...props}
    >
      <div className={cn(BRANCH_ROW_CONTENT_CLASS, 'pointer-events-none relative z-10', contentClassName)}>
        {content}
      </div>
      <div className={cn(BRANCH_ROW_ACTION_SLOT_CLASS, 'pointer-events-none relative z-20')}>{actions}</div>
    </li>
  )
}
