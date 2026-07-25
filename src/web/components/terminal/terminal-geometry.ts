import type { ITerminalInitOnlyOptions, ITerminalOptions } from '@xterm/xterm'

/**
 * Page-lifetime terminal font constants. If any of these ever becomes
 * user-configurable at runtime, xterm instances must be rebuilt against the
 * new values.
 */
export const TERMINAL_FONT_SIZE = 14
export const TERMINAL_FONT_FAMILY = "'Goblin Mono', monospace"
export const TERMINAL_LINE_HEIGHT = 1
export const TERMINAL_SCROLLBACK_ROWS = 10_000

export function createTerminalSizingOptions(): ITerminalOptions & ITerminalInitOnlyOptions {
  return {
    allowProposedApi: true,
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
