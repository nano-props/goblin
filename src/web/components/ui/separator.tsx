import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

type SeparatorOrientation = 'horizontal' | 'vertical'

interface SeparatorProps extends HTMLAttributes {
  orientation?: SeparatorOrientation
}

const Separator: FunctionalComponent<SeparatorProps> = (props, { attrs }) => {
  const resolvedOrientation = props.orientation ?? 'horizontal'
  const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
  return (
    <div
      {...elementAttrs}
      aria-hidden="true"
      data-slot="separator"
      data-orientation={resolvedOrientation}
      class={cn(
        'pointer-events-none shrink-0 bg-separator',
        resolvedOrientation === 'horizontal' ? 'h-px w-full' : 'h-4 w-px',
        classValue,
      )}
    />
  )
}

Separator.props = ['orientation']
Separator.inheritAttrs = false

export { Separator }
export type { SeparatorProps }
