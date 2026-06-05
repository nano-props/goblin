import { describe, expect, test } from 'vitest'
import { formatRelativeTime, formatRelativeTimeOrNull } from '#/web/lib/dates.ts'

describe('formatRelativeTime', () => {
  test('formats valid ISO dates relative to the base date', () => {
    expect(formatRelativeTime('2026-06-05T10:00:00.000Z', 'en', new Date('2026-06-05T12:00:00.000Z'))).toBe('2 hours ago')
  })

  test('returns the original value for invalid dates', () => {
    expect(formatRelativeTime('not-a-date', 'en', new Date('2026-06-05T12:00:00.000Z'))).toBe('not-a-date')
  })
})

describe('formatRelativeTimeOrNull', () => {
  test('returns null for empty values', () => {
    expect(formatRelativeTimeOrNull('', 'en', new Date('2026-06-05T12:00:00.000Z'))).toBeNull()
    expect(formatRelativeTimeOrNull(undefined, 'en', new Date('2026-06-05T12:00:00.000Z'))).toBeNull()
    expect(formatRelativeTimeOrNull(null, 'en', new Date('2026-06-05T12:00:00.000Z'))).toBeNull()
  })

  test('returns null for invalid dates', () => {
    expect(formatRelativeTimeOrNull('not-a-date', 'en', new Date('2026-06-05T12:00:00.000Z'))).toBeNull()
  })

  test('formats valid ISO dates relative to the base date', () => {
    expect(formatRelativeTimeOrNull('2026-06-05T10:00:00.000Z', 'en', new Date('2026-06-05T12:00:00.000Z'))).toBe(
      '2 hours ago',
    )
  })
})
