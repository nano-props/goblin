import type { ButtonHTMLAttributes, FunctionalComponent, HTMLAttributes, VNodeChild } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { focusRing } from '#/web/components/ui/focus.ts'

type MenuRowButtonProps = Omit<ButtonHTMLAttributes, 'size'> & {
  leading?: VNodeChild
  trailing?: VNodeChild
  contentClass?: HTMLAttributes['class']
  selected?: boolean
  size?: 'compact' | 'roomy'
}

const MENU_ROW_ICON_CLASS = 'flex size-3.5 shrink-0 items-center justify-center'
const MENU_ROW_BUTTON_BASE_CLASS =
  'flex w-full min-w-0 shrink-0 cursor-pointer items-center rounded-sm text-left text-sm outline-none transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50'

export const MenuRowButton: FunctionalComponent<MenuRowButtonProps> = (props, { slots }) => {
  const {
    class: classValue,
    contentClass,
    leading,
    selected = false,
    size = 'compact',
    trailing,
    type = 'button',
    ...buttonProps
  } = props

  return (
    <button
      {...buttonProps}
      type={type}
      class={cn(
        MENU_ROW_BUTTON_BASE_CLASS,
        focusRing,
        size === 'compact' && 'h-7 gap-2 px-2',
        size === 'roomy' && 'min-h-11 gap-2.5 py-1.5 pl-2 pr-8',
        selected
          ? 'bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground'
          : 'text-popover-foreground hover:bg-accent hover:text-accent-foreground',
        classValue,
      )}
    >
      {leading ? <span class={MENU_ROW_ICON_CLASS}>{leading}</span> : null}
      <span class={cn('min-w-0 flex-1 truncate', contentClass)}>{slots.default?.()}</span>
      {trailing ? <span class="ml-auto flex shrink-0 items-center">{trailing}</span> : null}
    </button>
  )
}
MenuRowButton.inheritAttrs = false
