import type { ComponentPropsWithoutRef, ReactNode, Ref } from 'react'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { cn } from '#/web/lib/cn.ts'

interface ToolbarTabStripProps {
  compact: boolean
  compactContent: ReactNode
  scrollContent: ReactNode
  viewportRef?: Ref<HTMLDivElement>
}

// Shared toolbar tab-strip shell:
// - compact mode keeps a single flex row in the toolbar height
// - expanded mode owns the horizontal ScrollArea + compact scrollbar semantics
export function ToolbarTabStrip({ compact, compactContent, scrollContent, viewportRef }: ToolbarTabStripProps) {
  if (compact) {
    return <div className="flex h-full min-w-0 flex-1 items-center">{compactContent}</div>
  }

  return (
    <ScrollArea
      orientation="horizontal"
      scrollbarMode="compact"
      className="h-full min-w-0 flex-1"
      viewportClassName="[&>div]:h-full"
      viewportRef={viewportRef}
    >
      {scrollContent}
    </ScrollArea>
  )
}

interface ToolbarTabStripBodyProps extends ComponentPropsWithoutRef<'div'> {
  scroll?: boolean
}

// Shared row wrapper used by repo/terminal strips.
// `scroll` adds the width contract required to create horizontal overflow inside ScrollArea.
export function ToolbarTabStripBody({ scroll = false, className, ...props }: ToolbarTabStripBodyProps) {
  return (
    <div className={cn('flex h-full min-w-0 items-center gap-1', scroll && 'w-max min-w-full', className)} {...props} />
  )
}

// Shared tablist layout contract. Consumers still provide the semantic role/aria-label.
export function ToolbarTabList({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex h-full min-w-0 items-center gap-1', className)} {...props} />
}
