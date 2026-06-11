// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import {
  SafariShiftKeyResolver,
  isMacNavigatorPlatform,
  terminalInputForMacOptionArrow,
} from '#/web/components/terminal/terminal-keyboard.ts'

const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function withUserAgent(ua: string, fn: () => void): void {
  const original = navigator.userAgent
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  try {
    fn()
  } finally {
    Object.defineProperty(navigator, 'userAgent', { value: original, configurable: true })
  }
}

function keyEvent(partial: {
  type?: string
  key: string
  code?: string
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}): Parameters<SafariShiftKeyResolver['inputForEvent']>[0] {
  return {
    type: 'keydown',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    code: '',
    ...partial,
  }
}

describe('SafariShiftKeyResolver', () => {
  test('returns null on non-Safari browsers', () => {
    withUserAgent(CHROME_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: ',', code: 'Comma', shiftKey: true }))).toBeNull()
    })
  })

  test('returns null when shiftKey is not pressed', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: ',', code: 'Comma', shiftKey: false }))).toBeNull()
    })
  })

  test('returns null for non-keydown events', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ type: 'keyup', key: ',', code: 'Comma', shiftKey: true }))).toBeNull()
    })
  })

  test('returns null when modifier keys are pressed', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: ',', code: 'Comma', shiftKey: true, ctrlKey: true }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: ',', code: 'Comma', shiftKey: true, altKey: true }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: ',', code: 'Comma', shiftKey: true, metaKey: true }))).toBeNull()
    })
  })

  test('returns null for unknown event.code', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: 'a', code: 'KeyA', shiftKey: true }))).toBeNull()
    })
  })

  test('returns null when key is already the correct shifted character', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: '<', code: 'Comma', shiftKey: true }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: '?', code: 'Slash', shiftKey: true }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: '《', code: 'Comma', shiftKey: true }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: '？', code: 'Slash', shiftKey: true }))).toBeNull()
    })
  })

  test('US QWERTY: returns shifted char when key reports unshifted char', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: ',', code: 'Comma', shiftKey: true }))).toBe('<')
      expect(resolver.inputForEvent(keyEvent({ key: '.', code: 'Period', shiftKey: true }))).toBe('>')
      expect(resolver.inputForEvent(keyEvent({ key: '/', code: 'Slash', shiftKey: true }))).toBe('?')
      expect(resolver.inputForEvent(keyEvent({ key: ';', code: 'Semicolon', shiftKey: true }))).toBe(':')
      expect(resolver.inputForEvent(keyEvent({ key: "'", code: 'Quote', shiftKey: true }))).toBe('"')
      expect(resolver.inputForEvent(keyEvent({ key: '[', code: 'BracketLeft', shiftKey: true }))).toBe('{')
      expect(resolver.inputForEvent(keyEvent({ key: ']', code: 'BracketRight', shiftKey: true }))).toBe('}')
      expect(resolver.inputForEvent(keyEvent({ key: '\\', code: 'Backslash', shiftKey: true }))).toBe('|')
    })
  })

  test('Chinese layout: returns full-width shifted char when key reports full-width unshifted char', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: '，', code: 'Comma', shiftKey: true }))).toBe('《')
      expect(resolver.inputForEvent(keyEvent({ key: '。', code: 'Period', shiftKey: true }))).toBe('》')
      expect(resolver.inputForEvent(keyEvent({ key: '、', code: 'Slash', shiftKey: true }))).toBe('？')
      expect(resolver.inputForEvent(keyEvent({ key: '；', code: 'Semicolon', shiftKey: true }))).toBe('：')
      expect(resolver.inputForEvent(keyEvent({ key: '‘', code: 'Quote', shiftKey: true }))).toBe('“')
      expect(resolver.inputForEvent(keyEvent({ key: '’', code: 'Quote', shiftKey: true }))).toBe('”')
      expect(resolver.inputForEvent(keyEvent({ key: '【', code: 'BracketLeft', shiftKey: true }))).toBe('｛')
      expect(resolver.inputForEvent(keyEvent({ key: '】', code: 'BracketRight', shiftKey: true }))).toBe('｝')
    })
  })

  test('returns default shifted char for empty or Unidentified key on single-layout keys', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: '', code: 'Digit1', shiftKey: true }))).toBe('!')
      expect(resolver.inputForEvent(keyEvent({ key: 'Unidentified', code: 'Digit2', shiftKey: true }))).toBe('@')
    })
  })

  test('returns null for empty or Unidentified key on multi-layout keys without remembered layout', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: '', code: 'Comma', shiftKey: true }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: 'Unidentified', code: 'Slash', shiftKey: true }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: '', code: 'Semicolon', shiftKey: true }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: 'Unidentified', code: 'Quote', shiftKey: true }))).toBeNull()
    })
  })

  test('reuses remembered layout for empty multi-layout Shift key events', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: '；', code: 'Semicolon', shiftKey: false }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: '', code: 'Semicolon', shiftKey: true }))).toBe('：')
      expect(resolver.inputForEvent(keyEvent({ key: '/', code: 'Slash', shiftKey: false }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: 'Unidentified', code: 'Slash', shiftKey: true }))).toBe('?')
    })
  })

  test('can learn layout from already-correct shifted key and reuse it later', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: '《', code: 'Comma', shiftKey: true }))).toBeNull()
      expect(resolver.inputForEvent(keyEvent({ key: '', code: 'Comma', shiftKey: true }))).toBe('《')
    })
  })

  test('reset clears remembered layouts', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: '；', code: 'Semicolon', shiftKey: false }))).toBeNull()
      resolver.reset()
      expect(resolver.inputForEvent(keyEvent({ key: '', code: 'Semicolon', shiftKey: true }))).toBeNull()
    })
  })

  test('returns null for unmatched key on a known code', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: 'x', code: 'Comma', shiftKey: true }))).toBeNull()
    })
  })
})

describe('terminalInputForMacOptionArrow', () => {
  test('returns escape sequence for Option+Arrow on Mac', () => {
    expect(
      terminalInputForMacOptionArrow(
        { type: 'keydown', key: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
        { isMac: true, applicationCursorKeysMode: false },
      ),
    ).toBe('\x1bb')
  })

  test('returns null when not on Mac', () => {
    expect(
      terminalInputForMacOptionArrow(
        { type: 'keydown', key: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
        { isMac: false, applicationCursorKeysMode: false },
      ),
    ).toBeNull()
  })

  test('returns null in application cursor keys mode', () => {
    expect(
      terminalInputForMacOptionArrow(
        { type: 'keydown', key: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
        { isMac: true, applicationCursorKeysMode: true },
      ),
    ).toBeNull()
  })
})

describe('isMacNavigatorPlatform', () => {
  test('recognizes Mac platforms', () => {
    expect(isMacNavigatorPlatform('MacIntel')).toBe(true)
    expect(isMacNavigatorPlatform('iPhone')).toBe(true)
    expect(isMacNavigatorPlatform('iPad')).toBe(true)
    expect(isMacNavigatorPlatform('Win32')).toBe(false)
    expect(isMacNavigatorPlatform('Linux x86_64')).toBe(false)
  })
})
