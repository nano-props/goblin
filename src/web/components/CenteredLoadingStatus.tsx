import { Loader2 } from '@lucide/vue'
import type { FunctionalComponent } from 'vue'

interface CenteredLoadingStatusProps {
  label?: string
  class?: string
}

export const CenteredLoadingStatus: FunctionalComponent<CenteredLoadingStatusProps> = (props) => (
  <div
    role="status"
    aria-live="polite"
    class={`flex h-full items-center justify-center bg-background text-muted-foreground ${props.class ?? ''}`}
  >
    <Loader2 class="size-5 animate-spin" aria-hidden="true" />
    <span class="sr-only">{props.label ?? 'Loading'}</span>
  </div>
)
CenteredLoadingStatus.props = ['label', 'class']
CenteredLoadingStatus.inheritAttrs = false
