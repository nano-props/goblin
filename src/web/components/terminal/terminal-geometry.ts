import type { ITerminalInitOnlyOptions, ITerminalOptions } from '@xterm/xterm'

export const DEFAULT_TERMINAL_COLS = 80
export const DEFAULT_TERMINAL_ROWS = 24

/**
 * Page-lifetime terminal font constants. If any of these ever becomes
 * user-configurable at runtime, xterm instances and startup geometry
 * estimates must be rebuilt against the new values.
 */
export const TERMINAL_FONT_SIZE = 14
export const TERMINAL_FONT_FAMILY = "'Goblin Mono', monospace"
export const TERMINAL_LINE_HEIGHT = 1
export const TERMINAL_SCROLLBACK_ROWS = 10_000

const FALLBACK_TERMINAL_CELL_WIDTH = TERMINAL_FONT_SIZE * 0.62
const FALLBACK_TERMINAL_CELL_HEIGHT = TERMINAL_FONT_SIZE * TERMINAL_LINE_HEIGHT
const MANAGED_TERMINAL_FRAME_PADDING_PX = 6
const MIN_INITIAL_TERMINAL_COLS = 2
const MIN_INITIAL_TERMINAL_ROWS = 1

/**
 * Process-wide cache of measured cell dimensions. Populated on the first
 * successful DOM probe and reused for the rest of the page lifetime. The
 * invariant is that the font family and size above do not change at runtime.
 */
let cachedTerminalCellMetrics: { cellWidth: number; cellHeight: number } | null = null

export function createTerminalSizingOptions(
  geometry: { cols: number; rows: number } = { cols: DEFAULT_TERMINAL_COLS, rows: DEFAULT_TERMINAL_ROWS },
): ITerminalOptions & ITerminalInitOnlyOptions {
  return {
    allowProposedApi: true,
    cols: geometry.cols,
    rows: geometry.rows,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: TERMINAL_FONT_SIZE,
    lineHeight: TERMINAL_LINE_HEIGHT,
    rescaleOverlappingGlyphs: true,
    scrollback: TERMINAL_SCROLLBACK_ROWS,
  }
}

export function preloadTerminalFont(): Promise<void> {
  if (!document.fonts) return Promise.resolve()
  const spec = `${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`
  if (document.fonts.check(spec)) return Promise.resolve()
  return document.fonts
    .load(spec)
    .then(() => {
      cachedTerminalCellMetrics = null
    })
    .catch(() => {})
}

export function estimateTerminalGeometry(host: HTMLElement): { cols: number; rows: number } | null {
  const rect = host.getBoundingClientRect()
  return estimateTerminalGeometryFromSize(rect.width, rect.height)
}

export function estimateManagedTerminalGeometry(host: HTMLElement): { cols: number; rows: number } | null {
  const rect = host.getBoundingClientRect()
  return estimateTerminalGeometryFromSize(
    rect.width - MANAGED_TERMINAL_FRAME_PADDING_PX * 2,
    rect.height - MANAGED_TERMINAL_FRAME_PADDING_PX * 2,
  )
}

function estimateTerminalGeometryFromSize(width: number, height: number): { cols: number; rows: number } | null {
  if (width <= 0 || height <= 0) return null
  const metrics = measureTerminalCell() ?? {
    cellWidth: FALLBACK_TERMINAL_CELL_WIDTH,
    cellHeight: FALLBACK_TERMINAL_CELL_HEIGHT,
  }
  return {
    cols: Math.max(MIN_INITIAL_TERMINAL_COLS, Math.floor(width / metrics.cellWidth)),
    rows: Math.max(MIN_INITIAL_TERMINAL_ROWS, Math.floor(height / metrics.cellHeight)),
  }
}

function measureTerminalCell(): { cellWidth: number; cellHeight: number } | null {
  if (cachedTerminalCellMetrics) return cachedTerminalCellMetrics
  if (!document.body) return null
  const canCache = isTerminalFontLoaded()
  const probe = document.createElement('span')
  probe.textContent = 'M'.repeat(100)
  probe.style.cssText = [
    'position:absolute',
    'top:-9999px',
    'left:-9999px',
    'visibility:hidden',
    'pointer-events:none',
    'white-space:pre',
    'letter-spacing:0',
    'font-variant-ligatures:none',
    `font-family:${TERMINAL_FONT_FAMILY}`,
    `font-size:${TERMINAL_FONT_SIZE}px`,
    `line-height:${TERMINAL_LINE_HEIGHT}`,
  ].join(';')
  document.body.appendChild(probe)
  const width = probe.offsetWidth
  const height = probe.offsetHeight
  probe.remove()
  if (width <= 0 || height <= 0) return null
  const metrics = { cellWidth: width / 100, cellHeight: height }
  if (canCache) cachedTerminalCellMetrics = metrics
  return metrics
}

function isTerminalFontLoaded(): boolean {
  if (!document.fonts) return true
  return document.fonts.check(`${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`)
}
