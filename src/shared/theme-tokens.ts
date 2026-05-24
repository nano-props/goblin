import type { ResolvedTheme } from '#/shared/rpc.ts'

// Main needs a window background before renderer CSS loads. Keep these
// values in sync with `--gbl-surface-canvas`; when custom themes land,
// replace this fixed map with the persisted theme canvas token.
export const WINDOW_BACKGROUND_BY_THEME: Record<ResolvedTheme, string> = {
  light: '#fbfbfd',
  dark: '#1c1c1e',
}
