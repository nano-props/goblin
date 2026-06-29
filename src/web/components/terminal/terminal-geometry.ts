import { FitAddon } from '@xterm/addon-fit'
import type { ITerminalInitOnlyOptions, ITerminalOptions } from '@xterm/xterm'
import { Terminal } from '@xterm/xterm'

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

export function proposeTerminalGeometry(host: HTMLElement): { cols: number; rows: number } | null {
  if (!hasMeasurableBox(host)) return null
  const term = new Terminal(createTerminalSizingOptions())
  const fitAddon = new FitAddon()
  try {
    term.loadAddon(fitAddon)
    term.open(host)
    const geometry = fitAddon.proposeDimensions()
    return geometry ? { cols: geometry.cols, rows: geometry.rows } : null
  } finally {
    term.dispose()
  }
}

export function proposeManagedTerminalGeometry(host: HTMLElement): { cols: number; rows: number } | null {
  if (!hasMeasurableBox(host)) return null
  const frame = document.createElement('div')
  frame.className = 'goblin-managed-terminal-frame'
  frame.style.position = 'absolute'
  frame.style.inset = '0'
  frame.style.visibility = 'hidden'
  frame.style.pointerEvents = 'none'

  const xtermHost = document.createElement('div')
  xtermHost.className = 'goblin-managed-terminal-host'
  frame.appendChild(xtermHost)
  host.appendChild(frame)
  try {
    return proposeTerminalGeometry(xtermHost)
  } finally {
    frame.remove()
  }
}

function hasMeasurableBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}
