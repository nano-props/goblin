import { workspacePaneRuntimeTabTargetKeyForType } from '#/web/workspace-pane/workspace-pane-runtime-tab-providers.ts'

export interface WorkspacePaneRuntimeTabTargetKeyInput {
  repoRoot: string
  worktreePath: string | null
}

export function workspacePaneRuntimeTabTargetKey(input: WorkspacePaneRuntimeTabTargetKeyInput): string | null {
  return workspacePaneRuntimeTabTargetKeyForType('terminal', input)
}
