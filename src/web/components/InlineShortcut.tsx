import { cn } from '#/web/lib/cn.ts'

interface InlineShortcutProps {
  shortcut: string
  /** When true, the shortcut is hidden until the parent element is hovered.
   * The parent must have the `group` class (or another group utility). */
  showOnHover?: boolean
  className?: string
  'aria-hidden'?: boolean
}

export function InlineShortcut({
  shortcut,
  showOnHover = false,
  className,
  'aria-hidden': ariaHidden,
}: InlineShortcutProps) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={cn(
        'ml-auto min-w-6 pl-8 text-right text-xs tracking-widest text-muted-foreground',
        showOnHover && 'opacity-0 transition-opacity duration-100 group-hover:opacity-100',
        className,
      )}
    >
      {shortcut}
    </span>
  )
}
