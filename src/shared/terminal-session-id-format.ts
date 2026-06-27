const TERMINAL_SESSION_ID_INDEX_RE = /^session-(\d+)$/

export function parseTerminalSessionIdIndex(sessionId: string): number | null {
  const match = TERMINAL_SESSION_ID_INDEX_RE.exec(sessionId)
  if (!match) return null
  const index = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(index) && index > 0 ? index : null
}

export function formatTerminalSessionId(index: number): string {
  return `session-${index}`
}
