import type { FunctionalComponent } from 'vue'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'

export const ScrollPane: FunctionalComponent = (_props, { slots }) => (
  <ScrollArea class="min-h-0 flex-1">{slots.default?.()}</ScrollArea>
)
