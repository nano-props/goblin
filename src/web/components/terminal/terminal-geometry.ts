import type { ITerminalInitOnlyOptions, ITerminalOptions } from '@xterm/xterm'

export const DEFAULT_TERMINAL_COLS = 80
export const DEFAULT_TERMINAL_ROWS = 24

/**
 * Page-lifetime terminal font constants. If any of these ever becomes
 * user-configurable at runtime, xterm instances and pre-create geometry
 * measurement must be rebuilt against the new values.
 */
export const TERMINAL_FONT_SIZE = 14
export const TERMINAL_FONT_FAMILY = "'Goblin Mono', monospace"
export const TERMINAL_LINE_HEIGHT = 1
export const TERMINAL_SCROLLBACK_ROWS = 10_000

const ESTIMATED_TERMINAL_CELL_WIDTH = TERMINAL_FONT_SIZE * 0.62
const ESTIMATED_TERMINAL_CELL_HEIGHT = TERMINAL_FONT_SIZE * TERMINAL_LINE_HEIGHT
const MANAGED_TERMINAL_FRAME_PADDING_PX = 6

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
    .then(() => {})
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
  return {
    cols: Math.max(2, Math.floor(width / ESTIMATED_TERMINAL_CELL_WIDTH)),
    rows: Math.max(1, Math.floor(height / ESTIMATED_TERMINAL_CELL_HEIGHT)),
  }
}
