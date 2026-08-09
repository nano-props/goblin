import { Loader2 } from '@lucide/vue'
import { computed, defineComponent } from 'vue'
import type { FunctionalComponent, PropType } from 'vue'
import { AsyncButton } from '#/web/components/AsyncButton.tsx'
import { BranchActionsPopover } from '#/web/components/BranchActionsMenu.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.tsx'
import type { BranchActionItem, BranchActionSurface } from '#/web/hooks/useBranchActionItems.tsx'
import { useOverflowCollapse } from '#/web/hooks/useOverflowCollapse.ts'
import { cn } from '#/web/lib/cn.ts'
type BranchActionControlsVariant = 'bar' | 'menu' | 'auto'

interface BranchActionControlsProps {
  actions: Pick<BranchActionSurface, 'mainItems' | 'destructiveItems'>
  variant?: BranchActionControlsVariant
}

export function BranchActionControls({ actions, variant = 'bar' }: BranchActionControlsProps) {
  const { mainItems, destructiveItems } = actions
  const visibleItems = visibleBranchActionItems(actions)

  if (variant === 'menu') {
    return <BranchActionsPopover mainItems={mainItems} destructiveItems={destructiveItems} />
  }

  if (variant === 'auto') {
    return <BranchActionAuto visibleItems={visibleItems} mainItems={mainItems} destructiveItems={destructiveItems} />
  }

  return <BranchActionButtonScroller visibleItems={visibleItems} />
}

interface BranchActionAutoProps {
  visibleItems: BranchActionItem[]
  mainItems: BranchActionItem[]
  destructiveItems: BranchActionItem[]
}

const BranchActionAuto = defineComponent<BranchActionAutoProps>({
  name: 'BranchActionAuto',
  props: {
    visibleItems: { type: Array as PropType<BranchActionItem[]>, required: true },
    mainItems: { type: Array as PropType<BranchActionItem[]>, required: true },
    destructiveItems: { type: Array as PropType<BranchActionItem[]>, required: true },
  },

  setup(props) {
    const layoutKey = computed(() =>
      props.visibleItems.map((item) => `${item.id}:${item.label}:${item.disabled}`).join('|'),
    )
    const { containerRef, measureRef, collapsed } = useOverflowCollapse(layoutKey)

    return () => (
      <div ref={containerRef} class="relative flex min-w-0 flex-1 justify-end">
        {collapsed.value ? (
          <BranchActionsPopover mainItems={props.mainItems} destructiveItems={props.destructiveItems} />
        ) : (
          <BranchActionButtonScroller visibleItems={props.visibleItems} />
        )}
        <div ref={measureRef} aria-hidden="true" class="pointer-events-none invisible absolute right-0 top-0">
          <BranchActionButtonRow visibleItems={props.visibleItems} measure />
        </div>
      </div>
    )
  },
})

function BranchActionButtonScroller({ visibleItems }: { visibleItems: BranchActionItem[] }) {
  return (
    <ScrollArea orientation="horizontal" class="min-w-0">
      <BranchActionButtonRow visibleItems={visibleItems} class="min-w-full" />
    </ScrollArea>
  )
}

interface BranchActionButtonRowProps {
  visibleItems: BranchActionItem[]
  class?: string
  measure?: boolean
}

const BranchActionButtonRow: FunctionalComponent<BranchActionButtonRowProps> = ({
  visibleItems,
  class: classValue,
  measure = false,
}) => {
  return (
    <div class={cn('flex w-max items-center justify-end gap-1 py-1', classValue)}>
      {visibleItems.map((item) => (
        <BranchActionButton key={item.id} item={item} measure={measure} />
      ))}
    </div>
  )
}
BranchActionButtonRow.props = ['visibleItems', 'class', 'measure']
BranchActionButtonRow.inheritAttrs = false

function BranchActionButton({ item, measure = false }: { item: BranchActionItem; measure?: boolean }) {
  return (
    <AsyncButton
      variant="ghost"
      size="sm"
      loading={item.busy}
      disabled={measure || item.disabled}
      action={item.onSelect}
      title={item.title ?? item.label}
      aria-label={item.ariaLabel ?? item.title ?? item.label}
      class={item.destructive ? 'text-danger hover:bg-danger-surface hover:text-danger' : undefined}
    >
      {({ busy }: { busy: boolean }) => (
        <>
          {busy ? <Loader2 class="size-4 animate-spin" /> : item.icon}
          {item.label}
        </>
      )}
    </AsyncButton>
  )
}
