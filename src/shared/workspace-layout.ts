export const WORKSPACE_LAYOUTS = ['top-bottom', 'left-right'] as const

export type WorkspaceLayout = (typeof WORKSPACE_LAYOUTS)[number]
export type WorkspaceLayoutAxis = 'rows' | 'columns'
export type WorkspaceDetailPaneSizes = Record<WorkspaceLayout, number>

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = 'top-bottom'
export const DEFAULT_DETAIL_COLLAPSED = true
export const DEFAULT_DETAIL_FOCUS_MODE = false
export const DEFAULT_DETAIL_PANE_SIZES: WorkspaceDetailPaneSizes = { 'top-bottom': 61.8, 'left-right': 61.8 }

const MIN_DETAIL_PANE_SIZE = 10
const MAX_DETAIL_PANE_SIZE = 90

const WORKSPACE_LAYOUT_META = {
  'top-bottom': { axis: 'rows', detailCollapseAllowed: true },
  // Side-by-side layout always keeps both panes visible; collapsing the
  // detail pane would leave the branch list without its companion pane.
  'left-right': { axis: 'columns', detailCollapseAllowed: false },
} satisfies Record<WorkspaceLayout, { axis: WorkspaceLayoutAxis; detailCollapseAllowed: boolean }>

export function normalizeWorkspaceLayout(value: unknown): WorkspaceLayout {
  if (value === 'top-bottom' || value === 'left-right') return value
  return DEFAULT_WORKSPACE_LAYOUT
}

export function workspaceLayoutAxis(layout: WorkspaceLayout): WorkspaceLayoutAxis {
  return WORKSPACE_LAYOUT_META[layout].axis
}

export function workspaceLayoutAllowsDetailCollapse(layout: WorkspaceLayout): boolean {
  return WORKSPACE_LAYOUT_META[layout].detailCollapseAllowed
}

export function effectiveDetailCollapsed(layout: WorkspaceLayout, detailCollapsed: boolean): boolean {
  return workspaceLayoutAllowsDetailCollapse(layout) && detailCollapsed
}

export function normalizeDetailPaneSize(layout: WorkspaceLayout, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DETAIL_PANE_SIZES[layout]
  return Math.max(MIN_DETAIL_PANE_SIZE, Math.min(MAX_DETAIL_PANE_SIZE, Math.round(value * 10) / 10))
}

export function normalizeDetailPaneSizes(value: unknown): WorkspaceDetailPaneSizes {
  const sizes = value && typeof value === 'object' ? (value as Partial<Record<WorkspaceLayout, unknown>>) : {}
  return {
    'top-bottom': normalizeDetailPaneSize('top-bottom', sizes['top-bottom']),
    'left-right': normalizeDetailPaneSize('left-right', sizes['left-right']),
  }
}

export function normalizeWorkspaceSessionLayoutState(value: {
  workspaceLayout?: unknown
  detailCollapsed?: unknown
  detailFocusMode?: unknown
  detailPaneSizes?: unknown
}): {
  workspaceLayout: WorkspaceLayout
  detailCollapsed: boolean
  detailFocusMode: boolean
  detailPaneSizes: WorkspaceDetailPaneSizes
} {
  const workspaceLayout = normalizeWorkspaceLayout(value.workspaceLayout)
  const detailCollapsed = effectiveDetailCollapsed(
    workspaceLayout,
    typeof value.detailCollapsed === 'boolean' ? value.detailCollapsed : DEFAULT_DETAIL_COLLAPSED,
  )
  const detailFocusMode =
    workspaceLayout === 'top-bottom' && typeof value.detailFocusMode === 'boolean'
      ? value.detailFocusMode
      : DEFAULT_DETAIL_FOCUS_MODE
  return {
    workspaceLayout,
    detailCollapsed,
    detailFocusMode,
    detailPaneSizes: normalizeDetailPaneSizes(value.detailPaneSizes),
  }
}
