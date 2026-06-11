interface TerminalKeyEventLike {
  type: string
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  code?: string
}

const MAC_OPTION_ARROW_INPUT: Record<string, string> = {
  ArrowLeft: '\x1bb',
  ArrowRight: '\x1bf',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
}

// Safari has a longstanding bug where KeyboardEvent.key for Shift+symbol keys may report the
// unshifted character (e.g. '/' instead of '?') or even an empty string / 'Unidentified'.
// When xterm.js sees an empty/invalid key in evaluateKeyboardEvent, it falls through without
// setting result.key. _keyDown then returns true without cancelling the event, so the browser
// inserts the character into the hidden textarea. However _inputEvent ignores the input because
// _keyDownSeen is true and the event is not composed. The character is effectively lost.
// The second press often works because internal state has shifted. This map lets us bypass
// xterm.js keyboard handling for affected keys and send the correct character directly.
// https://bugs.webkit.org/show_bug.cgi?id=182566
//
// Each code maps to one or more [unshifted, shifted] pairs so that different keyboard layouts
// (US QWERTY, Chinese Simplified, etc.) are covered. When Safari reports a broken key we look up
// the pair whose unshifted side matches event.key and return the corresponding shifted character.
const SAFARI_SHIFT_KEY_PAIRS: Record<string, Array<[string, string]>> = {
  Backquote: [['`', '~']],
  Digit1: [['1', '!']],
  Digit2: [['2', '@']],
  Digit3: [['3', '#']],
  Digit4: [['4', '$']],
  Digit5: [['5', '%']],
  Digit6: [['6', '^']],
  Digit7: [['7', '&']],
  Digit8: [['8', '*']],
  Digit9: [['9', '(']],
  Digit0: [['0', ')']],
  Minus: [['-', '_']],
  Equal: [['=', '+']],
  BracketLeft: [
    ['[', '{'],
    ['【', '｛'],
  ],
  BracketRight: [
    [']', '}'],
    ['】', '｝'],
  ],
  Backslash: [
    ['\\', '|'],
    ['、', '｜'],
  ],
  Semicolon: [
    [';', ':'],
    ['；', '：'],
  ],
  Quote: [
    ["'", '"'],
    ['‘', '“'],
    ['’', '”'],
  ],
  Comma: [
    [',', '<'],
    ['，', '《'],
  ],
  Period: [
    ['.', '>'],
    ['。', '》'],
  ],
  Slash: [
    ['/', '?'],
    ['、', '？'],
  ],
}

export function terminalInputForMacOptionArrow(
  event: TerminalKeyEventLike,
  options: { isMac: boolean; applicationCursorKeysMode: boolean },
): string | null {
  if (!options.isMac || options.applicationCursorKeysMode || event.type !== 'keydown') return null
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  return MAC_OPTION_ARROW_INPUT[event.key] ?? null
}

export function terminalInputForSafariShiftKey(event: TerminalKeyEventLike): string | null {
  if (typeof navigator === 'undefined') return null
  if (!isSafariNavigator()) return null
  if (event.type !== 'keydown') return null
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null
  const code = event.code
  if (!code) return null
  const pairs = SAFARI_SHIFT_KEY_PAIRS[code]
  if (!pairs) return null

  // If key is already the expected shifted character for any known layout, let xterm.js handle it.
  for (const [, shifted] of pairs) {
    if (event.key === shifted) return null
  }

  // key is empty, Unidentified, or one of the known unshifted characters — override.
  if (!event.key || event.key === 'Unidentified') {
    return pairs[0][1]
  }
  for (const [unshifted, shifted] of pairs) {
    if (event.key === unshifted) return shifted
  }
  return null
}

export function isMacNavigatorPlatform(platform: string): boolean {
  return /\bMac|iPhone|iPad|iPod/.test(platform)
}

function isSafariNavigator(): boolean {
  try {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    // Match Safari but exclude Chrome/Chromium/Edge on iOS (they all report CriOS or EdgiOS).
    return /safari/i.test(userAgent) && !/chrome|crios|crmo|edgios/i.test(userAgent)
  } catch {
    return false
  }
}
