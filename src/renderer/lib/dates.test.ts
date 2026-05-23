import { describe, expect, test } from 'vitest'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'

describe('formatRelativeTime', () => {
  test('formats ISO dates in the active language', () => {
    const value = '2026-05-20T10:00:00+08:00'
    const base = new Date('2026-05-20T13:00:00+08:00')
    expect(formatRelativeTime(value, 'en', base)).toBe('3 hours ago')
    expect(formatRelativeTime(value, 'zh', base)).toBe('3 小时前')
    expect(formatRelativeTime(value, 'ja', base)).toBe('3時間前')
    expect(formatRelativeTime(value, 'ko', base)).toBe('3시간 전')
  })

  test('returns non-ISO legacy values unchanged', () => {
    expect(formatRelativeTime('3 hours ago', 'zh')).toBe('3 hours ago')
  })
})
