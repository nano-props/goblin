import { workspacePaneRuntimeTabTargetKeyForType } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export interface WorkspacePaneRuntimeTabTargetKeyInput {
  workspaceId: string
  worktreePath: string | null
}

export function workspacePaneRuntimeTabTargetKey(input: WorkspacePaneRuntimeTabTargetKeyInput): string | null {
  return workspacePaneRuntimeTabTargetKeyForType('terminal', input)
}
