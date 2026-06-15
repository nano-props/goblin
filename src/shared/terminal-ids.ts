const TERMINAL_ID_INDEX_RE = /^terminal-(\d+)$/

export function parseTerminalIdIndex(terminalId: string): number | null {
  const match = TERMINAL_ID_INDEX_RE.exec(terminalId)
  if (!match) return null
  const index = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(index) && index > 0 ? index : null
}

export function formatTerminalId(index: number): string {
  return `terminal-${index}`
}
