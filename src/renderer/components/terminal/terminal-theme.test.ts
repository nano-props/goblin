// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest'
import {
  observeTerminalTheme,
  TERMINAL_THEME_TOKENS_CHANGED_EVENT,
  terminalSearchDecorationsForCurrentDocument,
  terminalThemeForCurrentDocument,
} from '#/renderer/components/terminal/terminal-theme.ts'
import { installTerminalThemeStyles } from '#/renderer/components/terminal/terminal-theme-test-utils.ts'

beforeEach(() => {
  installTerminalThemeStyles()
  document.documentElement.setAttribute('data-theme', 'light')
  document.documentElement.removeAttribute('style')
})

describe('terminal theme', () => {
  test('returns a fresh theme object for each read', () => {
    const first = terminalThemeForCurrentDocument()
    const second = terminalThemeForCurrentDocument()
    first.background = '#000000'

    expect(second.background).toBe('#fbfbfd')
    expect(second.selectionBackground).toMatch(/^rgba\(0,\s*122,\s*255,\s*0\.22\)$/)
    expect(second.white).toBe('#6e6e73')
    expect(second.brightWhite).toBe('#1d1d1f')
    expect(terminalThemeForCurrentDocument().background).toBe('#fbfbfd')
  })

  test('resolves dark theme from html data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark')

    expect(terminalThemeForCurrentDocument()).toMatchObject({
      background: '#111113',
      foreground: '#f5f5f7',
      selectionBackground: expect.stringMatching(/^rgba\(10,\s*132,\s*255,\s*0\.32\)$/),
    })
  })

  test('resolves terminal search decorations from CSS tokens', () => {
    expect(terminalSearchDecorationsForCurrentDocument()).toMatchObject({
      matchBackground: '#facc15',
      matchOverviewRuler: '#facc15',
      activeMatchBackground: '#fb923c',
      activeMatchBorder: '#ffffff',
      activeMatchColorOverviewRuler: '#fb923c',
    })
  })

  test('observes inline token changes for custom theme previews', () => {
    const backgrounds: string[] = []
    const stop = observeTerminalTheme((theme) => backgrounds.push(theme.background ?? ''))

    document.documentElement.style.setProperty('--color-terminal-background', '#222222')
    window.dispatchEvent(new Event(TERMINAL_THEME_TOKENS_CHANGED_EVENT))
    stop()

    expect(backgrounds).toContain('#222222')
  })
})
