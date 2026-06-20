export type WorkspaceLayout = 'left-right'
export type WorkspacePaneSizes = Record<WorkspaceLayout, number>

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = 'left-right'
export const DEFAULT_WORKSPACE_PANE_FOCUS_MODE = false
export const DEFAULT_WORKSPACE_PANE_SIZES: WorkspacePaneSizes = { 'left-right': 61.8 }

const MIN_WORKSPACE_PANE_SIZE = 10
const MAX_WORKSPACE_PANE_SIZE = 90

export function normalizeWorkspaceLayout(value: unknown): WorkspaceLayout {
  if (value === 'left-right') return value
  return DEFAULT_WORKSPACE_LAYOUT
}

export function normalizeWorkspacePaneSize(layout: WorkspaceLayout, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WORKSPACE_PANE_SIZES[layout]
  return Math.max(MIN_WORKSPACE_PANE_SIZE, Math.min(MAX_WORKSPACE_PANE_SIZE, Math.round(value * 10) / 10))
}

export function normalizeWorkspacePaneSizes(value: unknown): WorkspacePaneSizes {
  const sizes = value && typeof value === 'object' ? (value as Partial<Record<WorkspaceLayout, unknown>>) : {}
  return {
    'left-right': normalizeWorkspacePaneSize('left-right', sizes['left-right']),
  }
}

export function normalizeWorkspaceSessionLayoutState(value: {
  workspacePaneFocusMode?: unknown
  workspacePaneSizes?: unknown
}): {
  workspacePaneFocusMode: boolean
  workspacePaneSizes: WorkspacePaneSizes
} {
  const workspacePaneFocusMode = typeof value.workspacePaneFocusMode === 'boolean' ? value.workspacePaneFocusMode : DEFAULT_WORKSPACE_PANE_FOCUS_MODE
  return {
    workspacePaneFocusMode,
    workspacePaneSizes: normalizeWorkspacePaneSizes(value.workspacePaneSizes),
  }
}
