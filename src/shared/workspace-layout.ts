export const DEFAULT_WORKSPACE_FOCUSED = false
export const DEFAULT_WORKSPACE_PANE_SIZE = 64

const MIN_WORKSPACE_PANE_SIZE = 10
const MAX_WORKSPACE_PANE_SIZE = 90

export function normalizeWorkspacePaneSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WORKSPACE_PANE_SIZE
  return Math.max(MIN_WORKSPACE_PANE_SIZE, Math.min(MAX_WORKSPACE_PANE_SIZE, Math.round(value * 10) / 10))
}

export function normalizeWorkspaceSessionLayoutState(value: {
  workspaceFocused?: unknown
  workspacePaneSize?: unknown
}): {
  workspaceFocused: boolean
  workspacePaneSize: number
} {
  return {
    workspaceFocused:
      typeof value.workspaceFocused === 'boolean' ? value.workspaceFocused : DEFAULT_WORKSPACE_FOCUSED,
    workspacePaneSize: normalizeWorkspacePaneSize(value.workspacePaneSize),
  }
}
