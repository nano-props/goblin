import type { LucideIcon } from 'lucide-react'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import { ToolbarTabStrip, ToolbarTabStripBody, ToolbarTabList } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import {
  toolbarTabButtonClassName,
  toolbarTabChromeClassName,
  toolbarTabIconClassName,
} from '#/web/components/tab-strip/tab-variants.ts'
import {
  WorkspaceToolbar,
  WorkspaceToolbarContent,
  WorkspaceToolbarLeadingSpacer,
  WorkspaceToolbarPrimary,
} from '#/web/components/workspace-toolbar-chrome.tsx'

interface RepoPageToolbarProps {
  icon: LucideIcon
  label: string
  trafficLightOffset?: boolean
}

export function RepoPageToolbar({ icon: Icon, label, trafficLightOffset = false }: RepoPageToolbarProps) {
  const tab = (
    <ToolbarClosableTab
      closeButton={false}
      containerClassName={toolbarTabChromeClassName({ variant: 'workspace', active: true })}
      buttonClassName={toolbarTabButtonClassName('workspace')}
      buttonProps={{ role: 'tab', 'aria-selected': true, title: label }}
    >
      <Icon size={14} className={toolbarTabIconClassName(true)} />
      <span className="min-w-0 truncate">{label}</span>
    </ToolbarClosableTab>
  )

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
