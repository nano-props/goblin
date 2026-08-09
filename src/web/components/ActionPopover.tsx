import { Loader2, MoreHorizontal } from '@lucide/vue'
import { PopoverTrigger } from 'reka-ui'
import { defineComponent, ref } from 'vue'
import type { PropType, VNodeChild } from 'vue'
import { Button } from '#/web/components/ui/button.tsx'
import { Popover, PopoverContent } from '#/web/components/ui/popover.tsx'
import { InlineShortcut } from '#/web/components/InlineShortcut.tsx'
import { cn } from '#/web/lib/cn.ts'

interface ActionPopoverState {
  readonly close: () => void
}

export const ActionPopover = defineComponent<{
  label: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  busy?: boolean
  triggerClass?: string
  contentClass?: string
}>({
  name: 'ActionPopover',
  props: {
    label: { type: String, required: true },
    open: { type: Boolean, default: undefined },
    onOpenChange: Function as PropType<(open: boolean) => void>,
    busy: Boolean,
    triggerClass: String,
    contentClass: String,
  },

  setup(props, { slots }) {
    const internalOpen = ref(false)

    function setOpen(next: boolean): void {
      if (props.open === undefined) internalOpen.value = next
      props.onOpenChange?.(next)
    }

    const state: ActionPopoverState = { close: () => setOpen(false) }

    return () => (
      <Popover open={props.open ?? internalOpen.value} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            data-action-popover-trigger=""
            variant="ghost"
            size="sm"
            title={props.label}
            aria-label={props.label}
            aria-busy={props.busy || undefined}
            onPointerdown={stopPropagation}
            onClick={stopPropagation}
            onDblclick={stopPropagation}
            class={props.triggerClass}
          >
            {props.busy ? <Loader2 class="size-4 animate-spin" /> : <MoreHorizontal class="size-4" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          class={cn('w-max min-w-48 max-w-72 overflow-hidden p-0', props.contentClass)}
          onOpenAutoFocus={(event: Event) => event.preventDefault()}
          onPointerdown={stopPropagation}
          onClick={stopPropagation}
        >
          {slots.default?.(state)}
        </PopoverContent>
      </Popover>
    )
  },
})

export const ActionPopoverItem = defineComponent<{
  label: string
  title?: string
  icon?: VNodeChild
  shortcut?: string
  disabled?: boolean
  busy?: boolean
  destructive?: boolean
  onSelect: () => void
}>({
  name: 'ActionPopoverItem',
  props: {
    label: { type: String, required: true },
    title: String,
    icon: null,
    shortcut: String,
    disabled: Boolean,
    busy: Boolean,
    destructive: Boolean,
    onSelect: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    return () => (
      <button
        type="button"
        disabled={props.disabled}
        title={props.title}
        onClick={props.onSelect}
        class={cn(
          'flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm py-1 pl-2 pr-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
          'focus:bg-accent focus:text-accent-foreground',
          props.destructive &&
            'text-danger hover:bg-danger-surface hover:text-danger focus:bg-danger-surface focus:text-danger',
          props.shortcut && 'whitespace-nowrap',
        )}
      >
        {props.icon || props.busy ? (
          <span class="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
            {props.busy ? <Loader2 size={16} class="animate-spin" /> : props.icon}
          </span>
        ) : null}
        <span class="min-w-0 flex-1 truncate">{props.label}</span>
        {props.shortcut ? <InlineShortcut shortcut={props.shortcut} /> : null}
      </button>
    )
  },
})

function stopPropagation(event: Event): void {
  event.stopPropagation()
}
