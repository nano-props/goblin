import { describe, expect, test } from 'vitest'
import {
  isMacNavigatorPlatform,
  terminalInputForMacOptionArrow,
} from '#/renderer/components/terminal/terminal-keyboard.ts'

const baseEvent = {
  type: 'keydown',
  key: 'ArrowLeft',
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
}

describe('terminal keyboard', () => {
  test('maps mac option arrows to VS Code-like terminal input', () => {
    expect(inputFor({ key: 'ArrowLeft' })).toBe('\x1bb')
    expect(inputFor({ key: 'ArrowRight' })).toBe('\x1bf')
    expect(inputFor({ key: 'ArrowUp' })).toBe('\x1b[A')
    expect(inputFor({ key: 'ArrowDown' })).toBe('\x1b[B')
  })

  test('does not remap non-mac or non-option-only key events', () => {
    expect(inputFor({}, { isMac: false })).toBeNull()
    expect(inputFor({}, { applicationCursorKeysMode: true })).toBeNull()
    expect(inputFor({ type: 'keyup' })).toBeNull()
    expect(inputFor({ altKey: false })).toBeNull()
    expect(inputFor({ ctrlKey: true })).toBeNull()
    expect(inputFor({ metaKey: true })).toBeNull()
    expect(inputFor({ shiftKey: true })).toBeNull()
    expect(inputFor({ key: 'KeyB' })).toBeNull()
  })

  test('recognizes mac navigator platforms', () => {
    expect(isMacNavigatorPlatform('MacIntel')).toBe(true)
    expect(isMacNavigatorPlatform('MacArm64')).toBe(true)
    expect(isMacNavigatorPlatform('iPad')).toBe(true)
    expect(isMacNavigatorPlatform('Win32')).toBe(false)
    expect(isMacNavigatorPlatform('Linux x86_64')).toBe(false)
  })
})

function inputFor(
  event: Partial<typeof baseEvent>,
  options: Partial<{ isMac: boolean; applicationCursorKeysMode: boolean }> = {},
): string | null {
  return terminalInputForMacOptionArrow(
    { ...baseEvent, ...event },
    { isMac: true, applicationCursorKeysMode: false, ...options },
  )
}
