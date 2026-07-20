import { workspacePaneRuntimeTabTargetKeyForType } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'
import type { WorkspacePaneRuntimeTabTargetInput } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export function workspacePaneRuntimeTabTargetKey(input: WorkspacePaneRuntimeTabTargetInput): string | null {
  return workspacePaneRuntimeTabTargetKeyForType('terminal', input)
}
