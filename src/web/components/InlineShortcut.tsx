import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

interface InlineShortcutProps {
  shortcut: string
  /** When true, the shortcut is hidden until the parent element is hovered.
   * The parent must have the `group` class (or another group utility). */
  showOnHover?: boolean
  class?: HTMLAttributes['class']
  ariaHidden?: boolean
}

export const InlineShortcut: FunctionalComponent<InlineShortcutProps> = (props) => {
  return (
    <span
      aria-hidden={props.ariaHidden}
      class={cn(
        'ml-auto min-w-6 pl-8 text-right text-xs tracking-widest text-muted-foreground',
        props.showOnHover && 'opacity-0 transition-opacity duration-100 group-hover:opacity-100',
        props.class,
      )}
    >
      {props.shortcut}
    </span>
  )
}
InlineShortcut.props = ['shortcut', 'showOnHover', 'class', 'ariaHidden']
InlineShortcut.inheritAttrs = false
