import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '#/web/lib/cn.ts'
import { focusRing } from '#/web/components/ui/focus.ts'

interface SidebarRowButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  children: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  contentClassName?: string
  fill?: boolean
  selected?: boolean
}

export const SIDEBAR_ROW_ICON_CLASS = 'flex size-4 shrink-0 items-center justify-center'
export const SIDEBAR_ROW_BUTTON_CLASS =
  'flex h-12 min-w-0 cursor-pointer items-center gap-2.5 rounded-md border border-transparent bg-transparent px-3 text-left text-sm font-medium outline-none transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50'

export const SidebarRowButton = forwardRef<HTMLButtonElement, SidebarRowButtonProps>(function SidebarRowButton(
  {
    children,
    leading,
    trailing,
    contentClassName,
    fill = true,
    selected = false,
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
      data-interactive
      className={cn(
        SIDEBAR_ROW_BUTTON_CLASS,
        focusRing,
        fill ? 'w-full flex-1' : 'max-w-64 shrink-0',
        selected
          ? 'bg-selected text-selected-foreground hover:bg-selected'
          : 'text-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      {leading ? <span className={SIDEBAR_ROW_ICON_CLASS}>{leading}</span> : null}
      <span className={cn('min-w-0 flex-1 truncate', contentClassName)}>{children}</span>
      {trailing ? (
        <span className="ml-auto flex shrink-0 items-center text-muted-foreground/70">{trailing}</span>
      ) : null}
    </button>
  )
})
