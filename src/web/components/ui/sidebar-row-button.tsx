import type { ButtonHTMLAttributes, FunctionalComponent, HTMLAttributes, VNodeChild } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { focusRing } from '#/web/components/ui/focus.ts'

type SidebarRowButtonProps = Omit<ButtonHTMLAttributes, 'size'> & {
  leading?: VNodeChild
  trailing?: VNodeChild
  contentClass?: HTMLAttributes['class']
  fill?: boolean
  selected?: boolean
  size?: 'default' | 'compact' | 'dense' | 'icon'
}

const SIDEBAR_ROW_ICON_CLASS = 'flex size-4 shrink-0 items-center justify-center'
const SIDEBAR_ROW_BUTTON_CLASS =
  'flex min-w-0 cursor-pointer items-center rounded-md border border-transparent bg-transparent text-left text-sm font-medium outline-none transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50'

export const SidebarRowButton: FunctionalComponent<SidebarRowButtonProps> = (props, { slots }) => {
  const {
    class: classValue,
    contentClass,
    fill: fillProp,
    leading,
    selected = false,
    size = 'default',
    trailing,
    type = 'button',
    ...buttonProps
  } = props
  const fill = fillProp ?? size !== 'icon'

  return (
    <button
      {...buttonProps}
      type={type}
      data-interactive
      class={cn(
        SIDEBAR_ROW_BUTTON_CLASS,
        focusRing,
        size === 'default' && 'h-10 gap-2.5 px-3',
        size === 'compact' && 'h-9 gap-2 px-2.5',
        size === 'dense' && 'h-8 gap-2 px-3 font-normal',
        size === 'icon' && 'size-9 justify-center px-0',
        fill ? 'w-full shrink-0' : size === 'icon' ? 'shrink-0' : 'max-w-64 shrink-0',
        selected
          ? 'bg-selected text-selected-foreground hover:bg-selected'
          : 'text-foreground hover:bg-accent hover:text-accent-foreground',
        size === 'dense' && !selected && 'text-foreground/85 hover:text-foreground',
        classValue,
      )}
    >
      {leading ? <span class={SIDEBAR_ROW_ICON_CLASS}>{leading}</span> : null}
      <span class={cn('min-w-0 flex-1 truncate', contentClass)}>{slots.default?.()}</span>
      {trailing ? <span class="ml-auto flex shrink-0 items-center text-muted-foreground/70">{trailing}</span> : null}
    </button>
  )
}
SidebarRowButton.inheritAttrs = false
