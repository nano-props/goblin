import { ArrowLeft } from '@lucide/vue'
import type { LucideIcon } from '@lucide/vue'
import { defineComponent } from 'vue'
import { Tip } from '#/web/components/Tip.tsx'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { ToolbarTabList, ToolbarTabStrip, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { toolbarTabChromeClassName, toolbarTabIconClassName } from '#/web/components/tab-strip/tab-variants.ts'
import { Button } from '#/web/components/ui/button.tsx'
import {
  WorkspaceToolbar,
  WorkspaceToolbarContent,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'

interface WorkspacePageToolbarProps {
  icon: LucideIcon
  label: string
  compact?: boolean
  trafficLightOffset?: boolean
  onBack?: () => void
}

export const WorkspacePageToolbar = defineComponent<WorkspacePageToolbarProps>({
  name: 'WorkspacePageToolbar',
  props: ['icon', 'label', 'compact', 'trafficLightOffset', 'onBack'],

  setup(props) {
    const t = useT()
    return () => {
      const Icon = props.icon
      const backLabel = t('workspace.back-to-workspace-navigator')
      const tab = (
        <ToolbarClosableTab
          containerClass={toolbarTabChromeClassName({ variant: 'workspace-pane', active: true })}
          buttonProps={{ role: 'tab', 'aria-selected': true, title: props.label }}
        >
          <Icon size={14} class={toolbarTabIconClassName(true)} />
          <span class="min-w-0 truncate">{props.label}</span>
        </ToolbarClosableTab>
      )

      if (props.compact) {
        return (
          <WorkspaceToolbar draggable={false} trafficLightOffset={props.trafficLightOffset ?? false}>
            <WorkspaceToolbarLeadingSpacer reserve={props.trafficLightOffset ?? false} />
            <WorkspaceToolbarContent>
              <WorkspaceToolbarPrimary>
                <Tip label={backLabel}>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 shrink-0"
                    onClick={props.onBack}
                    disabled={!props.onBack}
                    aria-label={backLabel}
                    title={backLabel}
                  >
                    <ArrowLeft size={14} />
                  </Button>
                </Tip>
                <div class="flex min-w-0 items-center gap-1.5 px-1 text-xs font-medium text-foreground">
                  <Icon size={14} class="shrink-0 text-muted-foreground" />
                  <span class="min-w-0 truncate">{props.label}</span>
                </div>
              </WorkspaceToolbarPrimary>
            </WorkspaceToolbarContent>
          </WorkspaceToolbar>
        )
      }

      return (
        <WorkspaceToolbar trafficLightOffset={props.trafficLightOffset ?? false}>
          <WorkspaceToolbarLeadingSpacer reserve={props.trafficLightOffset ?? false} />
          <WorkspaceToolbarContent>
            <WorkspaceToolbarPrimary>
              <ToolbarTabStrip
                compact={false}
                compactContent={tab}
                scrollContent={
                  <ToolbarTabStripBody scroll>
                    <ToolbarTabList role="tablist" aria-label={props.label}>
                      {tab}
                    </ToolbarTabList>
                  </ToolbarTabStripBody>
                }
              />
            </WorkspaceToolbarPrimary>
          </WorkspaceToolbarContent>
        </WorkspaceToolbar>
      )
    }
  },
})
