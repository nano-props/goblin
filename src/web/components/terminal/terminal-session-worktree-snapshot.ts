import { compactTerminalProcessName, compactTerminalTitle } from '#/web/components/terminal/terminal-title.ts'
import type {
  ManagedTerminalSlotLike,
  TerminalSlotSummary,
  TerminalSnapshot,
  WorktreeTerminalSnapshot,
} from '#/web/components/terminal/types.ts'

export function buildWorktreeTerminalSnapshot(input: {
  worktreeTerminalKey: string
  selectedDescriptor: WorktreeTerminalSnapshot['selectedDescriptor']
  pendingCreate: boolean
  slots: ManagedTerminalSlotLike[]
  selectedKey: string | null
  getCachedSnapshot: (key: string) => TerminalSnapshot | null
  cacheSnapshot: (key: string, snapshot: TerminalSnapshot) => void
  hasBell: (key: string) => boolean
  getDisplayOrder: (slot: ManagedTerminalSlotLike) => number
}): WorktreeTerminalSnapshot {
  const slots = buildTerminalSlotSummaries(input)
  const bellCount = slots.reduce((count, slot) => count + (slot.hasBell ? 1 : 0), 0)
  return {
    worktreeTerminalKey: input.worktreeTerminalKey,
    selectedDescriptor: input.selectedDescriptor,
    slots,
    count: slots.length,
    bellCount,
    pendingCreate: input.pendingCreate,
  }
}

function buildTerminalSlotSummaries(input: {
  worktreeTerminalKey: string
  slots: ManagedTerminalSlotLike[]
  selectedKey: string | null
  getCachedSnapshot: (key: string) => TerminalSnapshot | null
  cacheSnapshot: (key: string, snapshot: TerminalSnapshot) => void
  hasBell: (key: string) => boolean
  getDisplayOrder: (slot: ManagedTerminalSlotLike) => number
}): TerminalSlotSummary[] {
  return input.slots.map((slot) => {
    const cached = input.getCachedSnapshot(slot.descriptor.key)
    const snapshot = cached ?? slot.snapshot()
    if (!cached) input.cacheSnapshot(slot.descriptor.key, snapshot)
    return {
      type: 'terminal',
      id: slot.descriptor.key,
      key: slot.descriptor.key,
      worktreeTerminalKey: input.worktreeTerminalKey,
      slotId: slot.descriptor.slotId,
      index: slot.descriptor.index,
      displayOrder: input.getDisplayOrder(slot),
      title: summarizeTerminalTitle(snapshot, slot.descriptor.index),
      fullTitle: fullTerminalTitle(snapshot, slot.descriptor.index),
      originalTitle: terminalOriginalTitle(snapshot),
      phase: snapshot.phase,
      selected: slot.descriptor.key === input.selectedKey,
      hasBell: input.hasBell(slot.descriptor.key),
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
