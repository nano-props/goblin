export const REPO_SIDEBAR_MIN_WIDTH_REM = 14
export const REPO_WORKSPACE_MIN_WIDTH_REM = 22
export const REPO_SIDEBAR_MIN_WIDTH = `${REPO_SIDEBAR_MIN_WIDTH_REM}rem`
export const REPO_WORKSPACE_MIN_WIDTH = `${REPO_WORKSPACE_MIN_WIDTH_REM}rem`

export function repoSidebarWidthExpression(sidebarSize: number): string {
  return `max(${REPO_SIDEBAR_MIN_WIDTH}, min(${sidebarSize}%, calc(100% - ${REPO_WORKSPACE_MIN_WIDTH})))`
}

export function repoSidebarWidthPx({
  sidebarSize,
  totalPx,
  rootFontSizePx,
}: {
  sidebarSize: number
  totalPx: number
  rootFontSizePx: number
}): number | null {
  if (!Number.isFinite(sidebarSize) || !Number.isFinite(totalPx) || totalPx <= 0) return null

  const minSidebarPx = REPO_SIDEBAR_MIN_WIDTH_REM * rootFontSizePx
  const minWorkspacePx = REPO_WORKSPACE_MIN_WIDTH_REM * rootFontSizePx
  const maxSidebarPx = Math.max(minSidebarPx, totalPx - minWorkspacePx)
  const requestedPx = (sidebarSize / 100) * totalPx
  return Math.max(minSidebarPx, Math.min(maxSidebarPx, requestedPx))
}

export function clampRepoSidebarSizePercent({
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
    repoSidebarWidthPx({
      sidebarSize: (sidebarPx / totalPx) * 100,
      totalPx,
      rootFontSizePx,
    }) ?? sidebarPx
  return (clampedPx / totalPx) * 100
}
