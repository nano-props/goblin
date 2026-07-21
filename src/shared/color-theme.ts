import { isStringIn } from '#/shared/string-literals.ts'

// Keep this in sync with the pre-React allowlist in `src/web/public/boot.js`.
export const COLOR_THEMES = ['macos', 'mono', 'github'] as const

export type ColorTheme = (typeof COLOR_THEMES)[number]

export const DEFAULT_COLOR_THEME: ColorTheme = 'macos'

export function isColorTheme(value: unknown): value is ColorTheme {
  return isStringIn(COLOR_THEMES, value)
}
