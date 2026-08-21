import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

interface Props extends Omit<HTMLAttributes, 'class'> {
  /** Cap height of the wordmark in pixels. Default 13 (fits the window chrome toolbar). */
  size?: number
  class?: HTMLAttributes['class']
}

export const Logo: FunctionalComponent<Props> = ({ class: classValue, size = 13, ...props }) => {
  return (
    <span
      {...props}
      aria-label="Goblin"
      class={cn('inline-flex items-baseline align-middle select-none text-foreground', classValue)}
      style={{
        fontFamily: 'var(--font-sans)',
        fontWeight: 500,
        fontSize: `${size}px`,
        letterSpacing: `${size * 0.02}px`,
        lineHeight: 1,
      }}
    >
      Goblin
    </span>
  )
}
Logo.inheritAttrs = false
