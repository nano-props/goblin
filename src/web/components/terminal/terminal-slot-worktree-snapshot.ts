import { compactTerminalProcessName, compactTerminalTitle } from '#/web/components/terminal/terminal-title.ts'
import type {
  ManagedTerminalSessionLike,
  TerminalSlotSummary,
  TerminalSnapshot,
  WorktreeTerminalSnapshot,
} from '#/web/components/terminal/types.ts'

export function buildWorktreeTerminalSnapshot(input: {
  worktreeTerminalKey: string
  selectedDescriptor: WorktreeTerminalSnapshot['selectedDescriptor']
  pendingCreate: boolean
  sessions: ManagedTerminalSessionLike[]
  selectedKey: string | null
  getCachedSnapshot: (key: string) => TerminalSnapshot | null
  cacheSnapshot: (key: string, snapshot: TerminalSnapshot) => void
  hasBell: (key: string) => boolean
  getDisplayOrder: (session: ManagedTerminalSessionLike) => number
}): WorktreeTerminalSnapshot {
  const sessions = buildTerminalSessionSummaries(input)
  const bellCount = sessions.reduce((count, session) => count + (session.hasBell ? 1 : 0), 0)
  return {
    worktreeTerminalKey: input.worktreeTerminalKey,
    selectedDescriptor: input.selectedDescriptor,
    sessions,
    count: sessions.length,
    bellCount,
    pendingCreate: input.pendingCreate,
  }
}

function buildTerminalSessionSummaries(input: {
  worktreeTerminalKey: string
  sessions: ManagedTerminalSessionLike[]
  selectedKey: string | null
  getCachedSnapshot: (key: string) => TerminalSnapshot | null
  cacheSnapshot: (key: string, snapshot: TerminalSnapshot) => void
  hasBell: (key: string) => boolean
  getDisplayOrder: (session: ManagedTerminalSessionLike) => number
}): TerminalSlotSummary[] {
  return input.sessions.map((session) => {
    const cached = input.getCachedSnapshot(session.descriptor.key)
    const snapshot = cached ?? session.snapshot()
    if (!cached) input.cacheSnapshot(session.descriptor.key, snapshot)
    return {
      type: 'terminal',
      id: session.descriptor.key,
      key: session.descriptor.key,
      worktreeTerminalKey: input.worktreeTerminalKey,
      slotId: session.descriptor.slotId,
      index: session.descriptor.index,
      displayOrder: input.getDisplayOrder(session),
      title: summarizeTerminalTitle(snapshot, session.descriptor.index),
      fullTitle: fullTerminalTitle(snapshot, session.descriptor.index),
      originalTitle: terminalOriginalTitle(snapshot),
      phase: snapshot.phase,
      selected: session.descriptor.key === input.selectedKey,
      hasBell: input.hasBell(session.descriptor.key),
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
