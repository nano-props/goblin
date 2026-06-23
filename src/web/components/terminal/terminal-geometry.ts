/**
 * Test-only fixtures: historical fallback geometry used by tests that mock
 * the terminal-geometry module. Production code MUST go through
 * `waitForMeasurableHost` (in terminal-session-geometry.ts) instead of
 * falling back to these — see docs/terminal.md "Geometry and layout model".
 */
export const DEFAULT_TERMINAL_COLS = 80
export const DEFAULT_TERMINAL_ROWS = 24

/**
 * Page-lifetime constants. The cell-metrics cache below assumes these
 * do not change for the page's lifetime; if any of them ever becomes
 * user-configurable at runtime, the cache must be invalidated on
 * change.
 */
export const TERMINAL_FONT_SIZE = 14
// Font fallback chain: 'Goblin Mono' (Maple Mono NF CN) handles ASCII / CJK /
// Nerd Font glyphs, then platform color-emoji fonts cover U+1F000+ codepoints
// that Maple Mono does not carry. Without the emoji fallback, Linux and
// Windows users see tofu boxes for 🚀, 👨‍👩‍👧 etc. because `monospace` alone
// resolves to a font with no color emoji on most distros.
// Order matters: platform-native emoji fonts first so the OS can supply
// flag / skin-tone / ZWJ sequences with its own substitution tables.
export const TERMINAL_FONT_FAMILY =
  "'Goblin Mono', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', monospace"
export const TERMINAL_LINE_HEIGHT = 1

const MIN_INITIAL_TERMINAL_COLS = 2
const MIN_INITIAL_TERMINAL_ROWS = 1
const TERMINAL_SCROLLBAR_WIDTH = 14

/**
 * Process-wide cache of measured cell dimensions. Populated on the
 * first successful `measureTerminalCell()` call and reused for the
 * rest of the page lifetime. The invariant is that the font family
 * and size above never change at runtime; if they ever do, the cache
 * must be invalidated. There is no automatic invalidation by design.
 */
let cachedTerminalCellMetrics: { cellWidth: number; cellHeight: number } | null = null

export function preloadTerminalFont(): Promise<void> {
  if (!document.fonts) return Promise.resolve()
  const spec = `${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`
  if (document.fonts.check(spec)) return Promise.resolve()
  return document.fonts
    .load(spec)
    .then(() => {})
    .catch(() => {})
}

export function proposeTerminalGeometry(host: HTMLElement): { cols: number; rows: number } | null {
  if (!hasMeasurableBox(host)) return null
  const metrics = measureTerminalCell()
  if (!metrics) return null
  const rect = host.getBoundingClientRect()
  const availableWidth = Math.max(0, rect.width - TERMINAL_SCROLLBAR_WIDTH)
  return {
    cols: Math.max(MIN_INITIAL_TERMINAL_COLS, Math.floor(availableWidth / metrics.cellWidth)),
    rows: Math.max(MIN_INITIAL_TERMINAL_ROWS, Math.floor(rect.height / metrics.cellHeight)),
  }
}

function measureTerminalCell(): { cellWidth: number; cellHeight: number } | null {
  if (cachedTerminalCellMetrics) return cachedTerminalCellMetrics
  if (!document.body) return null
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
  cachedTerminalCellMetrics = { cellWidth: width / 100, cellHeight: height }
  return cachedTerminalCellMetrics
}

function hasMeasurableBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
