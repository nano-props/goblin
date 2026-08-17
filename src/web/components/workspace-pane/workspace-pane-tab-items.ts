import type { WorkspacePaneStaticTabMetadataInput } from '#/web/workspace-pane/tab-providers.ts'
import { workspacePaneRuntimeTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  createPendingWorkspacePaneTabItem,
  createRuntimePlaceholderWorkspacePaneTabItem,
  createRuntimeWorkspacePaneTabItem,
  createStaticWorkspacePaneTabItem,
  isPendingWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'

interface WorkspacePaneTabItemsInput {
  model: WorkspacePaneTabModel
  workspacePaneId: string
  branchName: string | null
  statusCount: number | undefined
  t: WorkspacePaneStaticTabMetadataInput['t']
}

export function workspacePaneTabItems(input: WorkspacePaneTabItemsInput): WorkspacePaneTabItem[] {
  return input.model.tabs.flatMap<WorkspacePaneTabItem>((tab) => {
    if (tab.kind === 'static') {
      const { type } = tab
      const provider = workspacePaneStaticTabProvider(type)
      const metadata = { t: input.t, branchName: input.branchName, statusCount: input.statusCount }
      return [
        createStaticWorkspacePaneTabItem({
          type,
          label: provider.label(metadata),
          tooltip: provider.tooltip(metadata),
          closeLabel: provider.closeLabel(metadata),
          panelId: provider.panelId(input.workspacePaneId),
        }),
      ]
    }
    const provider = workspacePaneRuntimeTabProvider(tab.runtimeType)
    if (tab.kind === 'pending') {
      const runtimeState = input.model.runtimeTabStateByType[tab.runtimeType]
      const label = provider.pendingLabel({
        t: input.t,
        createPending: runtimeState.createPending,
        projectionPhase: runtimeState.projectionPhase,
      })
      return [
        createPendingWorkspacePaneTabItem({
          type: tab.type,
          label,
          tooltip: label,
          panelId: provider.panelId(input.workspacePaneId),
        }),
      ]
    }
    if (tab.kind === 'runtime-placeholder') {
      const label = provider.placeholderLabel({
        t: input.t,
        projectionPhase: tab.projectionPhase,
      })
      return [
        createRuntimePlaceholderWorkspacePaneTabItem({
          tabEntry: tab.tabEntry,
          label,
          busy: tab.projectionPhase === 'pending',
          panelId: provider.panelId(input.workspacePaneId),
        }),
      ]
    }
    const metadata = { t: input.t, branchName: input.branchName, statusCount: input.statusCount, view: tab.view }
    return [
      createRuntimeWorkspacePaneTabItem({
        view: tab.view,
        label: provider.label(metadata),
        tooltip: provider.tooltip(metadata),
        closeLabel: provider.closeLabel(metadata),
        panelId: provider.panelId(input.workspacePaneId),
      }),
    ]
  })
}

export function workspacePaneTabEntryForItem(item: WorkspacePaneTabItem) {
  return isPendingWorkspacePaneTabItem(item) ? null : item.tabEntry
}
