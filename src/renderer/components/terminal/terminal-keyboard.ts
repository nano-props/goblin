interface TerminalKeyEventLike {
  type: string
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

const MAC_OPTION_ARROW_INPUT: Record<string, string> = {
  ArrowLeft: '\x1bb',
  ArrowRight: '\x1bf',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
}

export function terminalInputForMacOptionArrow(
  event: TerminalKeyEventLike,
  options: { isMac: boolean; applicationCursorKeysMode: boolean },
): string | null {
  if (!options.isMac || options.applicationCursorKeysMode || event.type !== 'keydown') return null
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  return MAC_OPTION_ARROW_INPUT[event.key] ?? null
}

export function isMacNavigatorPlatform(platform: string): boolean {
  return /\bMac|iPhone|iPad|iPod/.test(platform)
}
