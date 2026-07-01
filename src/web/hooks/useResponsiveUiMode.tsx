import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useIsSmallScreen } from '#/web/hooks/useIsSmallScreen.ts'

export type ResponsiveUiMode = 'default' | 'compact'
interface ResponsiveUiContextValue {
  mode: ResponsiveUiMode
  compact: boolean
}

const ResponsiveUiContext = createContext<ResponsiveUiContextValue | null>(null)

export function ResponsiveUiProvider({ children }: { children: ReactNode }) {
  const isSmallScreen = useIsSmallScreen()
  const value = useMemo<ResponsiveUiContextValue>(
    () => ({
      mode: isSmallScreen ? 'compact' : 'default',
      compact: isSmallScreen,
    }),
    [isSmallScreen],
  )
  return <ResponsiveUiContext value={value}>{children}</ResponsiveUiContext>
}

export function useResponsiveUi(): ResponsiveUiContextValue {
  const context = useContext(ResponsiveUiContext)
  const isSmallScreen = useIsSmallScreen()
  return context ?? { mode: isSmallScreen ? 'compact' : 'default', compact: isSmallScreen }
}

export function useResponsiveUiMode(): ResponsiveUiMode {
  return useResponsiveUi().mode
}

export function useIsCompactUi(): boolean {
  return useResponsiveUi().compact
}
