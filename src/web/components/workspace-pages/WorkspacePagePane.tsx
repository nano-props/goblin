import type { LucideIcon } from '@lucide/vue'
import type { FunctionalComponent } from 'vue'
import { ScrollPane } from '#/web/components/Layout.tsx'
import { Skeleton } from '#/web/components/ui/skeleton.tsx'
import { WorkspacePageToolbar } from '#/web/components/workspace-pages/WorkspacePageToolbar.tsx'

interface WorkspacePagePaneProps {
  icon: LucideIcon
  label: string
  compact?: boolean
  trafficLightOffset?: boolean
  onBack?: () => void
}

export const WorkspacePagePane: FunctionalComponent<WorkspacePagePaneProps> = (props, { slots }) => (
  <section class="flex min-h-0 flex-1 flex-col bg-background">
    <WorkspacePageToolbar
      icon={props.icon}
      label={props.label}
      compact={props.compact ?? false}
      trafficLightOffset={props.trafficLightOffset ?? false}
      onBack={props.onBack}
    />
    {slots.default?.()}
  </section>
)

WorkspacePagePane.props = ['icon', 'label', 'compact', 'trafficLightOffset', 'onBack']

export const WorkspacePageLoadingBody: FunctionalComponent = () => (
  <ScrollPane>
    <div data-testid="workspace-page-loading" class="w-full p-4" aria-busy="true">
      <div class="space-y-4">
        <Skeleton class="h-6 w-40" />
        <div class="space-y-2">
          <Skeleton class="h-4 w-24" />
          <Skeleton class="h-8 w-full" />
        </div>
        <div class="space-y-2">
          <Skeleton class="h-4 w-32" />
          <Skeleton class="h-8 w-full" />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <Skeleton class="h-7 w-16" />
          <Skeleton class="h-7 w-24" />
        </div>
      </div>
    </div>
  </ScrollPane>
)

export const WorkspacePageQuietLoadingBody: FunctionalComponent = () => (
  <div data-testid="workspace-page-quiet-loading" class="min-h-0 flex-1" aria-busy="true" />
)
