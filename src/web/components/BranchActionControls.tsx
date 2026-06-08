import { useLayoutEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AsyncButton } from '#/web/components/AsyncButton.tsx'
import { BranchActionsDropdown } from '#/web/components/BranchActionsMenu.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { type BranchActionItem, type BranchActionItemGroups, visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { cn } from '#/web/lib/cn.ts'
type BranchActionControlsVariant = 'bar' | 'menu' | 'auto'

interface BranchActionControlsProps {
  actions: BranchActionItemGroups
  variant?: BranchActionControlsVariant
}

export function BranchActionControls({ actions, variant = 'bar' }: BranchActionControlsProps) {
  const { patchItems, mainItems, destructiveItems } = actions
  const visibleItems = visibleBranchActionItems(actions)

  if (variant === 'menu') {
    return <BranchActionsDropdown patchItems={patchItems} mainItems={mainItems} destructiveItems={destructiveItems} />
  }

  if (variant === 'auto') {
    return (
      <BranchActionAuto
        visibleItems={visibleItems}
        patchItems={patchItems}
        mainItems={mainItems}
        destructiveItems={destructiveItems}
      />
    )
  }

  return <BranchActionButtonScroller visibleItems={visibleItems} />
}

function BranchActionAuto({
  visibleItems,
  patchItems,
  mainItems,
  destructiveItems,
}: {
  visibleItems: BranchActionItem[]
  patchItems: BranchActionItem[]
  mainItems: BranchActionItem[]
  destructiveItems: BranchActionItem[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const layoutKey = visibleItems.map((item) => `${item.id}:${item.label}:${item.disabled}`).join('|')

  useLayoutEffect(() => {
    const update = () => {
      const container = containerRef.current
      const measure = measureRef.current
      if (!container || !measure) return
      const next = measure.scrollWidth > container.clientWidth + 1
      setCollapsed((current) => (current === next ? current : next))
    }
    update()

    const ResizeObserverCtor = globalThis.ResizeObserver
    if (!ResizeObserverCtor) {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserverCtor(update)
    if (containerRef.current) observer.observe(containerRef.current)
    if (measureRef.current) observer.observe(measureRef.current)
    return () => observer.disconnect()
  }, [layoutKey])

  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-1 justify-end">
      {collapsed ? (
        <BranchActionsDropdown patchItems={patchItems} mainItems={mainItems} destructiveItems={destructiveItems} />
      ) : (
        <BranchActionButtonScroller visibleItems={visibleItems} />
      )}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute right-0 top-0">
        <BranchActionButtonRow visibleItems={visibleItems} measure />
      </div>
    </div>
  )
}

function BranchActionButtonScroller({ visibleItems }: { visibleItems: BranchActionItem[] }) {
  return (
    <ScrollArea orientation="horizontal" className="min-w-0">
      <BranchActionButtonRow visibleItems={visibleItems} className="min-w-full" />
    </ScrollArea>
  )
}

function BranchActionButtonRow({
  visibleItems,
  className,
  measure = false,
}: {
  visibleItems: BranchActionItem[]
  className?: string
  measure?: boolean
}) {
  return (
    <div className={cn('flex w-max items-center justify-end gap-1 py-1', className)}>
      {visibleItems.map((item) => (
        <BranchActionButton key={item.id} item={item} measure={measure} />
      ))}
    </div>
  )
}

function BranchActionButton({ item, measure = false }: { item: BranchActionItem; measure?: boolean }) {
  return (
    <AsyncButton
      variant="ghost"
      size="sm"
      loading={item.busy}
      disabled={measure || item.disabled}
      onClick={item.onSelect}
      title={item.title ?? item.label}
      aria-label={item.ariaLabel ?? item.title ?? item.label}
      className={item.destructive ? 'text-danger hover:bg-danger-surface hover:text-danger' : undefined}
    >
      {({ busy }) => (
        <>
          {busy ? <Loader2 size={16} className="animate-spin" /> : item.icon}
          {item.label}
        </>
      )}
    </AsyncButton>
  )
}
