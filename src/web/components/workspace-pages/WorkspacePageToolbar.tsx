import { ArrowLeft, type LucideIcon } from 'lucide-react'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { ToolbarTabStrip, ToolbarTabStripBody, ToolbarTabList } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { toolbarTabChromeClassName, toolbarTabIconClassName } from '#/web/components/tab-strip/tab-variants.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarContent,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { useT } from '#/web/stores/i18n.ts'

interface WorkspacePageToolbarProps {
  icon: LucideIcon
  label: string
  compact?: boolean
  trafficLightOffset?: boolean
  onBack?: () => void
}

export function WorkspacePageToolbar({
  icon: Icon,
  label,
  compact = false,
  trafficLightOffset = false,
  onBack,
}: WorkspacePageToolbarProps) {
  const t = useT()
  const backLabel = t('workspace.back-to-workspace-navigator')
  const tab = (
    <ToolbarClosableTab
      closeButton={false}
      containerClassName={toolbarTabChromeClassName({ variant: 'workspace-pane', active: true })}
      buttonProps={{ role: 'tab', 'aria-selected': true, title: label }}
    >
      <Icon size={14} className={toolbarTabIconClassName(true)} />
      <span className="min-w-0 truncate">{label}</span>
    </ToolbarClosableTab>
  )

  if (compact) {
    return (
      <WorkspaceToolbar draggable={false} trafficLightOffset={trafficLightOffset}>
        <WorkspaceToolbarLeadingSpacer reserve={trafficLightOffset} />
        <WorkspaceToolbarContent>
          <WorkspaceToolbarPrimary>
            <Tip label={backLabel}>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={onBack}
                disabled={!onBack}
                aria-label={backLabel}
                title={backLabel}
              >
                <ArrowLeft size={14} />
              </Button>
            </Tip>
            <div className="flex min-w-0 items-center gap-1.5 px-1 text-xs font-medium text-foreground">
              <Icon size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{label}</span>
            </div>
          </WorkspaceToolbarPrimary>
        </WorkspaceToolbarContent>
      </WorkspaceToolbar>
    )
  }

  return (
    <WorkspaceToolbar trafficLightOffset={trafficLightOffset}>
      <WorkspaceToolbarLeadingSpacer reserve={trafficLightOffset} />
      <WorkspaceToolbarContent>
        <WorkspaceToolbarPrimary>
          <ToolbarTabStrip
            compact={false}
            compactContent={tab}
            scrollContent={
              <ToolbarTabStripBody scroll>
                <ToolbarTabList role="tablist" aria-label={label}>
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
