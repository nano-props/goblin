import { compactTerminalProcessName, compactTerminalTitle } from '#/web/components/terminal/terminal-title.ts'
import type {
  TerminalSessionLike,
  TerminalSessionSummary,
  TerminalSnapshot,
  TerminalFilesystemTargetSnapshot,
} from '#/web/components/terminal/types.ts'

export function buildTerminalFilesystemTargetSnapshot(input: {
  terminalFilesystemTargetKey: string
  selectedDescriptor: TerminalFilesystemTargetSnapshot['selectedDescriptor']
  createPending: boolean
  sessions: TerminalSessionLike[]
  selectedTerminalSessionId: string | null
  getCachedSnapshot: (terminalSessionId: string) => TerminalSnapshot | null
  cacheSnapshot: (terminalSessionId: string, snapshot: TerminalSnapshot) => void
  hasBell: (terminalSessionId: string) => boolean
  hasRecentOutput: (terminalSessionId: string) => boolean
}): TerminalFilesystemTargetSnapshot {
  const sessions = buildTerminalSessionSummaries(input)
  const bellCount = sessions.reduce((count, session) => count + (session.hasBell ? 1 : 0), 0)
  const outputActiveCount = sessions.reduce((count, session) => count + (session.hasRecentOutput ? 1 : 0), 0)
  return {
    terminalFilesystemTargetKey: input.terminalFilesystemTargetKey,
    selectedDescriptor: input.selectedDescriptor,
    sessions,
    count: sessions.length,
    bellCount,
    outputActiveCount,
    createPending: input.createPending,
  }
}

function buildTerminalSessionSummaries(input: {
  terminalFilesystemTargetKey: string
  sessions: TerminalSessionLike[]
  selectedTerminalSessionId: string | null
  getCachedSnapshot: (terminalSessionId: string) => TerminalSnapshot | null
  cacheSnapshot: (terminalSessionId: string, snapshot: TerminalSnapshot) => void
  hasBell: (terminalSessionId: string) => boolean
  hasRecentOutput: (terminalSessionId: string) => boolean
}): TerminalSessionSummary[] {
  return input.sessions.map((session) => {
    const cached = input.getCachedSnapshot(session.descriptor.terminalSessionId)
    const snapshot = cached ?? session.snapshot()
    if (!cached) input.cacheSnapshot(session.descriptor.terminalSessionId, snapshot)
    return {
      type: 'terminal',
      terminalSessionId: session.descriptor.terminalSessionId,
      terminalFilesystemTargetKey: input.terminalFilesystemTargetKey,
      index: session.descriptor.index,
      title: summarizeTerminalTitle(snapshot, session.descriptor.index),
      fullTitle: fullTerminalTitle(snapshot, session.descriptor.index),
      originalTitle: terminalOriginalTitle(snapshot),
      processName: snapshot.processName,
      phase: snapshot.phase,
      selected: session.descriptor.terminalSessionId === input.selectedTerminalSessionId,
      hasBell: input.hasBell(session.descriptor.terminalSessionId),
      hasRecentOutput: input.hasRecentOutput(session.descriptor.terminalSessionId),
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
