import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

interface NavigatorSectionHeaderProps extends HTMLAttributes {
  title: string
}

export const NavigatorSectionHeader: FunctionalComponent<NavigatorSectionHeaderProps> = (props, { slots }) => (
  <div class={cn('shrink-0 px-3 pb-2', props.class)}>
    <div class="flex h-8 min-w-0 items-center gap-2 px-3">
      <div class="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground">{props.title}</div>
      {slots.default?.()}
    </div>
  </div>
)

NavigatorSectionHeader.inheritAttrs = false
