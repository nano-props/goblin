import { createContext, useContext } from 'react'
import type { TerminalSlotContextValue, TerminalSlotReadContextValue } from '#/web/components/terminal/types.ts'
export const TerminalSlotContext = createContext<TerminalSlotContextValue | null>(null)
export const TerminalSlotReadContext = createContext<TerminalSlotReadContextValue | null>(null)

export function useTerminalSlotContext(): TerminalSlotContextValue {
  const value = useContext(TerminalSlotContext)
  if (!value) throw new Error('Terminal session context is unavailable')
  return value
}

export function useTerminalSlotReadContext(): TerminalSlotReadContextValue {
  const value = useContext(TerminalSlotReadContext)
  if (!value) throw new Error('Terminal session read context is unavailable')
  return value
}
