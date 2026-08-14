import type { ITheme } from '@xterm/xterm'
import type { ISearchOptions } from '@xterm/addon-search'
type TerminalSearchDecorations = NonNullable<ISearchOptions['decorations']>

export const TERMINAL_THEME_TOKENS_CHANGED_EVENT = 'theme-tokens-changed'

export function terminalThemeForCurrentDocument(): ITheme {
  const styles = getComputedStyle(document.documentElement)
  return {
    background: cssToken(styles, '--color-terminal-background'),
    foreground: cssToken(styles, '--color-terminal-foreground'),
    cursor: cssToken(styles, '--color-terminal-cursor'),
    selectionBackground: cssToken(styles, '--color-terminal-selection-background'),
    black: cssToken(styles, '--color-terminal-ansi-black'),
    red: cssToken(styles, '--color-terminal-ansi-red'),
    green: cssToken(styles, '--color-terminal-ansi-green'),
    yellow: cssToken(styles, '--color-terminal-ansi-yellow'),
    blue: cssToken(styles, '--color-terminal-ansi-blue'),
    magenta: cssToken(styles, '--color-terminal-ansi-magenta'),
    cyan: cssToken(styles, '--color-terminal-ansi-cyan'),
    white: cssToken(styles, '--color-terminal-ansi-white'),
    brightBlack: cssToken(styles, '--color-terminal-ansi-bright-black'),
    brightRed: cssToken(styles, '--color-terminal-ansi-bright-red'),
    brightGreen: cssToken(styles, '--color-terminal-ansi-bright-green'),
    brightYellow: cssToken(styles, '--color-terminal-ansi-bright-yellow'),
    brightBlue: cssToken(styles, '--color-terminal-ansi-bright-blue'),
    brightMagenta: cssToken(styles, '--color-terminal-ansi-bright-magenta'),
    brightCyan: cssToken(styles, '--color-terminal-ansi-bright-cyan'),
    brightWhite: cssToken(styles, '--color-terminal-ansi-bright-white'),
  }
}

export function terminalSearchDecorationsForCurrentDocument(): TerminalSearchDecorations {
  const styles = getComputedStyle(document.documentElement)
  const match = cssToken(styles, '--color-terminal-search-match')
  const activeMatch = cssToken(styles, '--color-terminal-search-active-match')
  return {
    matchBackground: match,
    matchOverviewRuler: match,
    activeMatchBackground: activeMatch,
    activeMatchBorder: cssToken(styles, '--color-terminal-search-active-border'),
    activeMatchColorOverviewRuler: activeMatch,
  }
}

export function observeTerminalTheme(onTheme: (theme: ITheme) => void): () => void {
  const refresh = () => onTheme(terminalThemeForCurrentDocument())
  const observer = new MutationObserver(refresh)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-color-theme', 'data-theme-id', 'style'],
  })
  window.addEventListener(TERMINAL_THEME_TOKENS_CHANGED_EVENT, refresh)
  return () => {
    observer.disconnect()
    window.removeEventListener(TERMINAL_THEME_TOKENS_CHANGED_EVENT, refresh)
  }
}

function cssToken(styles: CSSStyleDeclaration, name: string): string {
  return resolveCssValue(styles, styles.getPropertyValue(name).trim(), new Set([name]))
}

function resolveCssValue(styles: CSSStyleDeclaration, value: string, seen: Set<string>): string {
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]+)?\)/g, (_match, token: string) => {
    if (seen.has(token)) return ''
    seen.add(token)
    const resolved = resolveCssValue(styles, styles.getPropertyValue(token).trim(), seen)
    seen.delete(token)
    return resolved
  })
}
