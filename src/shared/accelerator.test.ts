import { describe, expect, test } from 'vitest'
import { isReservedGlobalShortcut, normalizeGlobalShortcut } from '#/shared/accelerator.ts'

describe('accelerator helpers', () => {
  test('reserves app-level terminal and workspace tab shortcuts from global shortcut capture', () => {
    expect(isReservedGlobalShortcut('Command+N')).toBe(true)
    expect(isReservedGlobalShortcut('Control+N')).toBe(true)
    expect(isReservedGlobalShortcut('Command+5')).toBe(true)
    expect(isReservedGlobalShortcut('Control+9')).toBe(true)
    expect(isReservedGlobalShortcut('Command+B')).toBe(true)
    expect(isReservedGlobalShortcut('Control+U')).toBe(true)
    expect(isReservedGlobalShortcut('Command+Shift+R')).toBe(true)
  })

  test('normalizes reserved global shortcuts back to the default', () => {
    expect(normalizeGlobalShortcut('Command+N')).toBe('Alt+G')
    expect(normalizeGlobalShortcut('Control+9')).toBe('Alt+G')
  })
})
