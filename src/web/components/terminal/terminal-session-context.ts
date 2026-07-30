import { createContext, useContext } from 'react'
import { createInitialTerminalComposerState } from '#/web/components/terminal/terminal-composer-state.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSnapshot,
  TerminalFilesystemTargetSnapshot,
} from '#/web/components/terminal/types.ts'

export const TerminalSessionContext = createContext<TerminalSessionContextValue | null>(null)
export const TerminalSessionReadContext = createContext<TerminalSessionReadContextValue | null>(null)

export const EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT: TerminalFilesystemTargetSnapshot = {
  terminalFilesystemTargetKey: '',
  selectedDescriptor: null,
  sessions: [],
  count: 0,
  bellCount: 0,
  outputActiveCount: 0,
  createPending: false,
}

export const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = {
  phase: 'opening',
  message: null,
  processName: 'terminal',
  composer: createInitialTerminalComposerState(),
}

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
