import { createContext, useContext } from 'react'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
export const TerminalSessionContext = createContext<TerminalSessionContextValue | null>(null)
export const TerminalSessionReadContext = createContext<TerminalSessionReadContextValue | null>(null)

export function useTerminalSessionContext(): TerminalSessionContextValue {
  const value = useContext(TerminalSessionContext)
  if (!value) throw new Error('Terminal session context is unavailable')
  return value
}

export function useTerminalSessionReadContext(): TerminalSessionReadContextValue {
  const value = useContext(TerminalSessionReadContext)
  if (!value) throw new Error('Terminal session read context is unavailable')
  return value
}
