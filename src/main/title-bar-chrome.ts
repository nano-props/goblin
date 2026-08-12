import type { TitleBarOverlayOptions } from 'electron'
import { WINDOW_BACKGROUND_BY_COLOR_THEME } from '#/shared/theme-tokens.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'

export function defaultTitleBarStyle(): 'hiddenInset' | 'hidden' {
  return process.platform === 'darwin' ? 'hiddenInset' : 'hidden'
}

export function supportsTitleBarOverlay(): boolean {
  return process.platform !== 'darwin'
}

export function titleBarOverlayForTheme(
  theme: 'light' | 'dark',
  colorTheme: ColorTheme,
  height: number,
): TitleBarOverlayOptions | undefined {
  if (!supportsTitleBarOverlay()) return undefined
  // Match the overlay strip to the window canvas token, not generic white /
  // black. Otherwise Win/Linux caption buttons render over a visibly
  // different band when the user switches to non-default color themes.
  const color = WINDOW_BACKGROUND_BY_COLOR_THEME[colorTheme][theme]
  return theme === 'dark' ? { color, symbolColor: '#ffffff', height } : { color, symbolColor: '#000000', height }
}

export function macTrafficLightPosition(topInset: number): { x: number; y: number } | undefined {
  if (process.platform !== 'darwin') return undefined
  return { x: 16, y: (topInset - 12) / 2 }
}
