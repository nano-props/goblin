import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

type PanelInsetProps = HTMLAttributes & {
  tone?: 'default' | 'muted' | 'dashed'
  size?: 'sm' | 'md' | 'lg'
}

export const PanelInset: FunctionalComponent<PanelInsetProps> = (props, { slots }) => {
  const { class: classValue, size = 'md', tone = 'default', ...elementProps } = props
  return (
    <div
      {...elementProps}
      class={cn(
        'rounded-md border',
        tone === 'default' && 'border-border/50 bg-background/60',
        tone === 'muted' && 'border-border/60 bg-muted/20',
        tone === 'dashed' && 'border-dashed border-border bg-transparent',
        size === 'sm' && 'px-2.5 py-2',
        size === 'md' && 'px-3 py-2',
        size === 'lg' && 'px-4 py-3',
        classValue,
      )}
    >
      {slots.default?.()}
    </div>
  )
}
PanelInset.inheritAttrs = false
