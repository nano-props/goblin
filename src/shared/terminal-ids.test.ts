import { describe, expect, test } from 'vitest'
import { formatSlotId, parseSlotIdIndex } from '#/shared/slot-ids.ts'

describe('slot id helpers', () => {
  test('parses standard slot ids into 1-based indexes', () => {
    expect(parseSlotIdIndex('slot-1')).toBe(1)
    expect(parseSlotIdIndex('slot-42')).toBe(42)
  })

  test('rejects non-standard slot ids', () => {
    expect(parseSlotIdIndex('slot-0')).toBeNull()
    expect(parseSlotIdIndex('slot-x')).toBeNull()
    expect(parseSlotIdIndex('term-1')).toBeNull()
  })

  test('formats standard slot ids', () => {
    expect(formatSlotId(3)).toBe('slot-3')
  })
})
