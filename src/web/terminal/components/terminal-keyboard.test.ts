// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import {
  SafariShiftKeyResolver,
  isImeOwnedKeyboardEvent,
  isMacNavigatorPlatform,
  isDesktopMacNavigatorPlatform,
  terminalInputForMacOptionArrow,
  terminalInputForVirtualKey,
} from '#/web/terminal/components/terminal-keyboard.ts'

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

  test.each(['ctrlKey', 'altKey', 'metaKey'] as const)('returns null when %s is pressed', (modifier) => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: ',', code: 'Comma', shiftKey: true, [modifier]: true }))).toBeNull()
    })
  })

  test('returns null for unknown event.code', () => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key: 'a', code: 'KeyA', shiftKey: true }))).toBeNull()
    })
  })

  test.each([
    ['<', 'Comma'],
    ['?', 'Slash'],
    ['《', 'Comma'],
    ['？', 'Slash'],
  ])('returns null when %s is already the shifted character', (key, code) => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key, code, shiftKey: true }))).toBeNull()
    })
  })

  test.each([
    [',', 'Comma', '<'],
    ['.', 'Period', '>'],
    ['/', 'Slash', '?'],
    [';', 'Semicolon', ':'],
    ["'", 'Quote', '"'],
    ['[', 'BracketLeft', '{'],
    [']', 'BracketRight', '}'],
    ['\\', 'Backslash', '|'],
  ])('maps US QWERTY %s (%s) to %s', (key, code, expected) => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key, code, shiftKey: true }))).toBe(expected)
    })
  })

  test.each([
    ['，', 'Comma', '《'],
    ['。', 'Period', '》'],
    ['、', 'Slash', '？'],
    ['；', 'Semicolon', '：'],
    ['‘', 'Quote', '“'],
    ['’', 'Quote', '”'],
    ['【', 'BracketLeft', '｛'],
    ['】', 'BracketRight', '｝'],
  ])('maps Chinese layout %s (%s) to %s', (key, code, expected) => {
    withUserAgent(SAFARI_UA, () => {
      const resolver = new SafariShiftKeyResolver()
      expect(resolver.inputForEvent(keyEvent({ key, code, shiftKey: true }))).toBe(expected)
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
  test.each([
    ['Mac normal cursor mode', { isMac: true, applicationCursorKeysMode: false }, '\x1bb'],
    ['non-Mac platform', { isMac: false, applicationCursorKeysMode: false }, null],
    ['application cursor mode', { isMac: true, applicationCursorKeysMode: true }, null],
  ] as const)('maps Option+Arrow for %s', (_scenario, options, expected) => {
    expect(
      terminalInputForMacOptionArrow(
        { type: 'keydown', key: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
        options,
      ),
    ).toBe(expected)
  })
})

describe('terminalInputForVirtualKey', () => {
  test.each([
    ['enter', '\r'],
    ['backspace', '\x7f'],
    ['tab', '\t'],
    ['escape', '\x1b'],
    ['clear-screen', '\x0c'],
    ['interrupt', '\x03'],
    ['eof', '\x04'],
  ] as const)('encodes %s', (key, expected) => {
    expect(terminalInputForVirtualKey(key, false)).toBe(expected)
  })

  test.each([
    ['arrow-up', 'A'],
    ['arrow-down', 'B'],
    ['arrow-left', 'D'],
    ['arrow-right', 'C'],
  ] as const)('encodes %s for normal and application cursor modes', (key, suffix) => {
    expect(terminalInputForVirtualKey(key, false)).toBe(`\x1b[${suffix}`)
    expect(terminalInputForVirtualKey(key, true)).toBe(`\x1bO${suffix}`)
  })
})

describe('isMacNavigatorPlatform', () => {
  test.each([
    ['MacIntel', true],
    ['iPhone', true],
    ['iPad', true],
    ['Win32', false],
    ['Linux x86_64', false],
  ] as const)('maps %s to %s', (platform, expected) => {
    expect(isMacNavigatorPlatform(platform)).toBe(expected)
  })
})

describe('isDesktopMacNavigatorPlatform', () => {
  test.each([
    ['MacIntel', true],
    ['MacPPC', true],
    ['iPhone', false],
    ['iPad', false],
    ['Win32', false],
  ] as const)('maps %s to %s', (platform, expected) => {
    expect(isDesktopMacNavigatorPlatform(platform)).toBe(expected)
  })
})

describe('isImeOwnedKeyboardEvent', () => {
  test.each([
    ['active composition', { isComposing: true, keyCode: 0 }, true],
    ['WebKit composition event', { isComposing: false, keyCode: 229 }, true],
    ['ordinary key event', { isComposing: false, keyCode: 27 }, false],
  ] as const)('maps %s to %s', (_scenario, event, expected) => {
    expect(isImeOwnedKeyboardEvent(event)).toBe(expected)
  })
})
