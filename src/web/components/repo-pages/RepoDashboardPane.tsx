import { WorkspaceChrome } from '#/web/components/workspace-toolbar-chrome.tsx'

interface RepoDashboardPaneProps {
  trafficLightOffset?: boolean
}

export function RepoDashboardPane({ trafficLightOffset = false }: RepoDashboardPaneProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspaceChrome trafficLightOffset={trafficLightOffset} />
      <div className="min-h-0 flex-1" />
    </section>
  )
}
