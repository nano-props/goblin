import { cn } from '#/web/lib/cn.ts'
const SELECTED_SEGMENTED_ITEM_CLASS =
  '!bg-muted !text-foreground hover:!bg-muted hover:!text-foreground data-[state=on]:!bg-muted data-[state=on]:!text-foreground'
const IDLE_SEGMENTED_ITEM_CLASS = 'text-muted-foreground hover:bg-muted hover:text-foreground'

export function segmentedItemClass(selected: boolean, className?: string): string {
  return cn(
    'size-7 min-w-0 p-0 shadow-none',
    selected ? SELECTED_SEGMENTED_ITEM_CLASS : IDLE_SEGMENTED_ITEM_CLASS,
    '[&_svg:not([class*=size-])]:size-3.5',
    className,
  )
}
