import type { ResolvedTheme } from '#/shared/rpc.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'

// Main needs a window background before renderer CSS loads. Keep these
// values in sync with each theme's `--goblin-surface-canvas` until themes
// become data-driven and main can read the persisted canvas token.
export const WINDOW_BACKGROUND_BY_COLOR_THEME: Record<ColorTheme, Record<ResolvedTheme, string>> = {
  macos: {
    light: '#fbfbfd',
    dark: '#1c1c1e',
  },
  mono: {
    light: '#ffffff',
    dark: '#09090b',
  },
  github: {
    light: '#ffffff',
    dark: '#0d1117',
  },
}
