import { compactTerminalProcessName, compactTerminalTitle } from '#/web/components/terminal/terminal-title.ts'
import type {
  TerminalSessionLike,
  TerminalSessionSummary,
  TerminalSnapshot,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'

export function buildTerminalWorktreeSnapshot(input: {
  terminalWorktreeKey: string
  selectedDescriptor: TerminalWorktreeSnapshot['selectedDescriptor']
  pendingCreate: boolean
  sessions: TerminalSessionLike[]
  selectedTerminalKey: string | null
  getCachedSnapshot: (terminalKey: string) => TerminalSnapshot | null
  cacheSnapshot: (terminalKey: string, snapshot: TerminalSnapshot) => void
  hasBell: (terminalKey: string) => boolean
  hasRecentActivity: (terminalKey: string) => boolean
  getDisplayOrder: (session: TerminalSessionLike) => number
}): TerminalWorktreeSnapshot {
  const sessions = buildTerminalSessionSummaries(input)
  const bellCount = sessions.reduce((count, session) => count + (session.hasBell ? 1 : 0), 0)
  const activeCount = sessions.reduce((count, session) => count + (session.recentlyActive ? 1 : 0), 0)
  return {
    terminalWorktreeKey: input.terminalWorktreeKey,
    selectedDescriptor: input.selectedDescriptor,
    sessions,
    count: sessions.length,
    bellCount,
    activeCount,
    pendingCreate: input.pendingCreate,
  }
}

function buildTerminalSessionSummaries(input: {
  terminalWorktreeKey: string
  sessions: TerminalSessionLike[]
  selectedTerminalKey: string | null
  getCachedSnapshot: (terminalKey: string) => TerminalSnapshot | null
  cacheSnapshot: (terminalKey: string, snapshot: TerminalSnapshot) => void
  hasBell: (terminalKey: string) => boolean
  hasRecentActivity: (terminalKey: string) => boolean
  getDisplayOrder: (session: TerminalSessionLike) => number
}): TerminalSessionSummary[] {
  return input.sessions.map((session) => {
    const cached = input.getCachedSnapshot(session.descriptor.terminalKey)
    const snapshot = cached ?? session.snapshot()
    if (!cached) input.cacheSnapshot(session.descriptor.terminalKey, snapshot)
    return {
      type: 'terminal',
      terminalKey: session.descriptor.terminalKey,
      terminalWorktreeKey: input.terminalWorktreeKey,
      sessionId: session.descriptor.sessionId,
      index: session.descriptor.index,
      displayOrder: input.getDisplayOrder(session),
      title: summarizeTerminalTitle(snapshot, session.descriptor.index),
      fullTitle: fullTerminalTitle(snapshot, session.descriptor.index),
      originalTitle: terminalOriginalTitle(snapshot),
      processName: snapshot.processName,
      phase: snapshot.phase,
      selected: session.descriptor.terminalKey === input.selectedTerminalKey,
      hasBell: input.hasBell(session.descriptor.terminalKey),
      recentlyActive: input.hasRecentActivity(session.descriptor.terminalKey),
    }
  })
}

function summarizeTerminalTitle(snapshot: TerminalSnapshot, index: number): string {
  const canonicalTitle = terminalOriginalTitle(snapshot) ?? ''
  if (canonicalTitle) return compactTerminalTitle(canonicalTitle) || canonicalTitle
  const processName = compactTerminalProcessName(snapshot.processName)
  return processName || `terminal ${index}`
}

function fullTerminalTitle(snapshot: TerminalSnapshot, index: number): string {
  const canonicalTitle = terminalOriginalTitle(snapshot) ?? ''
  return canonicalTitle || snapshot.processName || `terminal ${index}`
}

function terminalOriginalTitle(snapshot: TerminalSnapshot): string | null {
  const canonicalTitle = typeof snapshot.canonicalTitle === 'string' ? snapshot.canonicalTitle.trim() : ''
  return canonicalTitle || null
}
