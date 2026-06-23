const SLOT_ID_INDEX_RE = /^slot-(\d+)$/

export function parseSlotIdIndex(slotId: string): number | null {
  const match = SLOT_ID_INDEX_RE.exec(slotId)
  if (!match) return null
  const index = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(index) && index > 0 ? index : null
}

export function formatSlotId(index: number): string {
  return `slot-${index}`
}
