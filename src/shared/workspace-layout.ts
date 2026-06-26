export const DEFAULT_ZEN_MODE = false
export const DEFAULT_WORKSPACE_PANE_SIZE = 70

const MIN_WORKSPACE_PANE_SIZE = 10
const MAX_WORKSPACE_PANE_SIZE = 90

export function normalizeWorkspacePaneSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WORKSPACE_PANE_SIZE
  return Math.max(MIN_WORKSPACE_PANE_SIZE, Math.min(MAX_WORKSPACE_PANE_SIZE, Math.round(value * 10) / 10))
}

export function normalizeWorkspaceSessionLayoutState(value: {
  zenMode?: unknown
  workspacePaneSize?: unknown
}): {
  zenMode: boolean
  workspacePaneSize: number
} {
  return {
    zenMode: typeof value.zenMode === 'boolean' ? value.zenMode : DEFAULT_ZEN_MODE,
    workspacePaneSize: normalizeWorkspacePaneSize(value.workspacePaneSize),
  }
}
