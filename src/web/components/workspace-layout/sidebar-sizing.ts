const WORKSPACE_SIDEBAR_MIN_WIDTH_REM = 14
const WORKSPACE_PANE_MIN_WIDTH_REM = 22
export const WORKSPACE_SIDEBAR_MIN_WIDTH = `${WORKSPACE_SIDEBAR_MIN_WIDTH_REM}rem`
export const WORKSPACE_PANE_MIN_WIDTH = `${WORKSPACE_PANE_MIN_WIDTH_REM}rem`

export function workspaceSidebarWidthExpression(sidebarSize: number): string {
  return `max(${WORKSPACE_SIDEBAR_MIN_WIDTH}, min(${sidebarSize}%, calc(100% - ${WORKSPACE_PANE_MIN_WIDTH})))`
}

export function workspaceSidebarWidthPx({
  sidebarSize,
  totalPx,
  rootFontSizePx,
}: {
  sidebarSize: number
  totalPx: number
  rootFontSizePx: number
}): number | null {
  if (!Number.isFinite(sidebarSize) || !Number.isFinite(totalPx) || totalPx <= 0) return null

  const minSidebarPx = WORKSPACE_SIDEBAR_MIN_WIDTH_REM * rootFontSizePx
  const minWorkspacePx = WORKSPACE_PANE_MIN_WIDTH_REM * rootFontSizePx
  const maxSidebarPx = Math.max(minSidebarPx, totalPx - minWorkspacePx)
  const requestedPx = (sidebarSize / 100) * totalPx
  return Math.max(minSidebarPx, Math.min(maxSidebarPx, requestedPx))
}

export function clampWorkspaceSidebarSizePercent({
  sidebarPx,
  totalPx,
  rootFontSizePx,
}: {
  sidebarPx: number
  totalPx: number
  rootFontSizePx: number
}): number {
  if (!Number.isFinite(sidebarPx) || !Number.isFinite(totalPx) || totalPx <= 0) return 50

  const clampedPx =
    workspaceSidebarWidthPx({
      sidebarSize: (sidebarPx / totalPx) * 100,
      totalPx,
      rootFontSizePx,
    }) ?? sidebarPx
  return (clampedPx / totalPx) * 100
}
