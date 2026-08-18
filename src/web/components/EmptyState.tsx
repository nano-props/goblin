import type { FunctionalComponent, VNodeChild } from 'vue'
import { cn } from '#/web/lib/cn.ts'

interface EmptyStateProps {
  icon?: VNodeChild
  title: VNodeChild
  body?: VNodeChild
  tone?: 'neutral' | 'success'
}

export const EmptyState: FunctionalComponent<EmptyStateProps> = (props) => (
  <div class="flex flex-1 items-center justify-center p-6 text-center">
    <div class="space-y-1">
      {props.icon ? (
        <div
          class={cn(
            'mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full',
            props.tone === 'success' ? 'bg-success-surface text-success' : 'bg-muted text-muted-foreground',
          )}
        >
          {props.icon}
        </div>
      ) : null}
      <div class="text-sm font-medium text-foreground">{props.title}</div>
      {props.body ? <div class="text-xs text-muted-foreground">{props.body}</div> : null}
    </div>
  </div>
)

EmptyState.props = ['icon', 'title', 'body', 'tone']
