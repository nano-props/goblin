import { describe, expect, test } from 'vitest'
import {
  DEFAULT_GLOBAL_SHORTCUT,
  acceleratorToKeyLabels,
  formatAccelerator,
  globalShortcutFromKeyboardEvent,
  isReservedGlobalShortcut,
  normalizeGlobalShortcut,
  parseGlobalShortcut,
} from '#/shared/accelerator.ts'

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    altKey: false,
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent
}

describe('parseGlobalShortcut', () => {
  test('normalizes aliases and modifier order', () => {
    expect(parseGlobalShortcut('shift+cmd+g')).toBe('Command+Shift+G')
    expect(parseGlobalShortcut('option+control+f12')).toBe('Control+Alt+F12')
  })

  test('requires a primary modifier and one key', () => {
    expect(parseGlobalShortcut('Shift+G')).toBeNull()
    expect(parseGlobalShortcut('Command')).toBeNull()
    expect(parseGlobalShortcut('Command+G+H')).toBeNull()
  })

  test('accepts app-reserved punctuation keys for conflict checks', () => {
    expect(parseGlobalShortcut('Command+,')).toBe('Command+,')
    expect(parseGlobalShortcut('Control+]')).toBe('Control+]')
  })
})

describe('global shortcut reservations', () => {
  test('rejects app menu shortcuts as global activation shortcuts', () => {
    expect(isReservedGlobalShortcut('Command+O')).toBe(true)
    expect(isReservedGlobalShortcut('Control+W')).toBe(true)
    expect(isReservedGlobalShortcut('Control+Shift+W')).toBe(true)
    expect(isReservedGlobalShortcut('Command+Alt+I')).toBe(true)
    expect(isReservedGlobalShortcut('Control+C')).toBe(true)
    expect(isReservedGlobalShortcut('Command+Q')).toBe(true)
    expect(isReservedGlobalShortcut('Alt+G')).toBe(false)
  })

  test('normalization falls back from invalid or reserved values', () => {
    expect(normalizeGlobalShortcut('Command+O')).toBe(DEFAULT_GLOBAL_SHORTCUT)
    expect(normalizeGlobalShortcut('Shift+G')).toBe(DEFAULT_GLOBAL_SHORTCUT)
    expect(normalizeGlobalShortcut('Control+Alt+K')).toBe('Control+Alt+K')
  })
})

describe('globalShortcutFromKeyboardEvent', () => {
  test('records supported keys with a primary modifier', () => {
    expect(globalShortcutFromKeyboardEvent(keyEvent({ altKey: true, code: 'KeyG' }))).toBe('Alt+G')
    expect(globalShortcutFromKeyboardEvent(keyEvent({ ctrlKey: true, shiftKey: true, code: 'Digit1' }))).toBe(
      'Control+Shift+1',
    )
    expect(globalShortcutFromKeyboardEvent(keyEvent({ metaKey: true, code: 'F24' }))).toBe('Command+F24')
  })

  test('rejects unsupported keys and shift-only combinations', () => {
    expect(globalShortcutFromKeyboardEvent(keyEvent({ altKey: true, code: 'BracketRight' }))).toBeNull()
    expect(globalShortcutFromKeyboardEvent(keyEvent({ shiftKey: true, code: 'KeyG' }))).toBeNull()
  })
})

describe('shortcut labels', () => {
  test('formats shortcuts for compact display', () => {
    expect(formatAccelerator('Command+Shift+G')).toBe('⌘⇧G')
    expect(acceleratorToKeyLabels('Control+Alt+,')).toEqual(['⌃', '⌥', ','])
    expect(acceleratorToKeyLabels('not-valid')).toEqual(['not-valid'])
  })
})
