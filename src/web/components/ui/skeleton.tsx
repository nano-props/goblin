import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

type SkeletonProps = HTMLAttributes

const Skeleton: FunctionalComponent<SkeletonProps> = (_props, { attrs, slots }) => {
  const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
  return (
    <div {...elementAttrs} class={cn('animate-pulse rounded-md bg-muted', classValue)}>
      {slots.default?.()}
    </div>
  )
}

Skeleton.inheritAttrs = false

export { Skeleton }
export type { SkeletonProps }
