import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '#/web/lib/cn.ts'
import { focusRing } from '#/web/components/ui/focus.ts'

interface MenuRowButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  children: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  contentClassName?: string
  selected?: boolean
  size?: 'compact' | 'roomy'
}

const MENU_ROW_ICON_CLASS = 'flex size-3.5 shrink-0 items-center justify-center'
const MENU_ROW_BUTTON_BASE_CLASS =
  'flex w-full min-w-0 shrink-0 cursor-pointer items-center rounded-sm text-left text-sm outline-none transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50'

export const MenuRowButton = forwardRef<HTMLButtonElement, MenuRowButtonProps>(function MenuRowButton(
  {
    children,
    leading,
    trailing,
    contentClassName,
    selected = false,
    size = 'compact',
    className,
    type = 'button',
    ...buttonProps
  },
  forwardedRef,
) {
  return (
    <button
      {...buttonProps}
      ref={forwardedRef}
      type={type}
      className={cn(
        MENU_ROW_BUTTON_BASE_CLASS,
        focusRing,
        size === 'compact' && 'h-7 gap-2 px-2',
        size === 'roomy' && 'min-h-11 gap-2.5 py-1.5 pl-2 pr-8',
        selected
          ? 'bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground'
          : 'text-popover-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      {leading ? <span className={MENU_ROW_ICON_CLASS}>{leading}</span> : null}
      <span className={cn('min-w-0 flex-1 truncate', contentClassName)}>{children}</span>
      {trailing ? <span className="ml-auto flex shrink-0 items-center">{trailing}</span> : null}
    </button>
  )
})
