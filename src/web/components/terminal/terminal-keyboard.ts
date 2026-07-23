interface SessionIdEventLike {
  type: string
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  code?: string
}

interface KeyOwnershipEventLike {
  type: string
  key: string
  code?: string
  repeat: boolean
}

type SafariShiftKeyPair = readonly [unshifted: string, shifted: string]

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
// (US QWERTY, Chinese Simplified, etc.) are covered. When Safari reports a broken Shift+symbol
// key we either match the current event.key to one of the known layouts or reuse the most
// recently observed layout for that physical key, then send the corresponding shifted character.
const SAFARI_SHIFT_KEY_PAIRS: Record<string, ReadonlyArray<SafariShiftKeyPair>> = {
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
  event: SessionIdEventLike,
  options: { isMac: boolean; applicationCursorKeysMode: boolean },
): string | null {
  if (!options.isMac || options.applicationCursorKeysMode || event.type !== 'keydown') return null
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  return MAC_OPTION_ARROW_INPUT[event.key] ?? null
}

/**
 * Rejects browser key-repeat events whose initial keydown belonged to another
 * focus target. This prevents a key held on the hidden navigation focus sink
 * from beginning to write merely because focus later moves to xterm.
 */
export class TerminalKeyRepeatFilter {
  private readonly pressedKeys = new Set<string>()

  reset(): void {
    this.pressedKeys.clear()
  }

  accepts(event: KeyOwnershipEventLike): boolean {
    const key = event.code || event.key
    if (!key) return true
    if (event.type === 'keyup') {
      this.pressedKeys.delete(key)
      return true
    }
    if (event.type === 'keydown' && !event.repeat) {
      this.pressedKeys.add(key)
      return true
    }
    return !event.repeat || this.pressedKeys.has(key)
  }
}

export class SafariShiftKeyResolver {
  private readonly layoutIndexByCode = new Map<string, number>()

  // This remembered-layout heuristic is intentionally per-terminal and best-effort. If the user
  // switches keyboard layouts and the first subsequent broken Shift+symbol event still reports an
  // empty/Unidentified key, we may briefly reuse the previous layout until a reliable event
  // updates the remembered mapping.
  reset(): void {
    this.layoutIndexByCode.clear()
  }

  inputForEvent(event: SessionIdEventLike): string | null {
    if (typeof navigator === 'undefined') return null
    if (!isSafariNavigator()) return null
    if (event.type !== 'keydown') return null
    if (event.ctrlKey || event.altKey || event.metaKey) return null
    const code = event.code
    if (!code) return null
    const pairs = SAFARI_SHIFT_KEY_PAIRS[code]
    if (!pairs) return null

    const layoutIndex = safariShiftLayoutIndexForKey(event.key, pairs, event.shiftKey ? 'either' : 'unshifted')
    if (layoutIndex != null) this.layoutIndexByCode.set(code, layoutIndex)
    if (!event.shiftKey) return null

    if (layoutIndex != null) {
      const [unshifted, shifted] = pairs[layoutIndex]
      if (event.key === shifted) return null
      if (event.key === unshifted) return shifted
    }

    // When Safari provides no usable key value, only fall back automatically for codes with a
    // single known layout. For multi-layout keys, use the most recently confirmed layout for this
    // physical key if we have one; otherwise stay hands-off and let xterm/browser behavior stand.
    if (!event.key || event.key === 'Unidentified') {
      const rememberedLayoutIndex = this.layoutIndexByCode.get(code)
      if (rememberedLayoutIndex != null) return pairs[rememberedLayoutIndex]?.[1] ?? null
      return pairs.length === 1 ? pairs[0][1] : null
    }

    return null
  }
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

function safariShiftLayoutIndexForKey(
  key: string,
  pairs: ReadonlyArray<SafariShiftKeyPair>,
  mode: 'unshifted' | 'either',
): number | null {
  if (!key || key === 'Unidentified') return null
  for (const [index, [unshifted, shifted]] of pairs.entries()) {
    if (key === unshifted) return index
    if (mode === 'either' && key === shifted) return index
  }
  return null
}
