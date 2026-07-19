import { workspacePaneRuntimeTabTargetKeyForType } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface WorkspacePaneRuntimeTabTargetKeyInput {
  workspaceId: WorkspaceId
  worktreePath: string | null
}

export function workspacePaneRuntimeTabTargetKey(input: WorkspacePaneRuntimeTabTargetKeyInput): string | null {
  return workspacePaneRuntimeTabTargetKeyForType('terminal', input)
}
