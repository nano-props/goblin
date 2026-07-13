import { createContext, useContext, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { goblinLog } from '#/web/logger.ts'
import { useT } from '#/web/stores/i18n.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSnapshot,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'
import type { TerminalCreateAdmissionResult } from '#/web/components/terminal/terminal-create-admission.ts'

export const TerminalSessionContext = createContext<TerminalSessionContextValue | null>(null)
export const TerminalSessionReadContext = createContext<TerminalSessionReadContextValue | null>(null)

/**
 * Empty fixtures shared by the missing-context fallbacks and consumer tests.
 *
 * Keeping a single source of truth means the fallback path produces exactly
 * the same shape that test suites already mock, so consumers (which already
 * tolerate `terminalWorktreeKey === null` / `terminalSessionId === null`)
 * stay safe when the provider is transiently absent during route transitions
 * or Suspense fallbacks.
 */
export const EMPTY_TERMINAL_WORKTREE_SNAPSHOT: TerminalWorktreeSnapshot = {
  terminalWorktreeKey: '',
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
}

export const EMPTY_TERMINAL_READ_CONTEXT_VALUE: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => EMPTY_TERMINAL_WORKTREE_SNAPSHOT,
  subscribeTerminalWorktree: () => () => {},
  repoBellCount: () => 0,
  subscribeRepoBellCount: () => () => {},
  snapshot: () => EMPTY_TERMINAL_SNAPSHOT,
  subscribeSnapshot: () => () => {},
}

const EMPTY_TERMINAL_CREATE_ADMISSION: TerminalCreateAdmissionResult = {
  terminalSessionId: '',
  resourceDisposition: 'created',
  workspacePaneTabs: { revision: 0, entries: [] },
  runtimeProjectionApplied: false,
  requestRole: 'leader',
}

export const EMPTY_TERMINAL_COMMAND_CONTEXT_VALUE: TerminalSessionContextValue = {
  createTerminal: () => Promise.resolve(''),
  createTerminalWithAdmission: () => Promise.resolve(EMPTY_TERMINAL_CREATE_ADMISSION),
  registerHost: () => {},
  unregisterHost: () => {},
  selectTerminal: () => {},
  scrollToBottom: () => {},
  scrollLines: () => {},
  clearBell: () => false,
  closeTerminalByDescriptor: () => Promise.resolve(false),
  attach: () => {},
  detach: () => {},
  restart: () => {},
  focusTerminal: () => {},
  isTerminalFocusTarget: () => false,
  findNext: () => ({ resultIndex: 0, resultCount: 0, found: false }),
  findPrevious: () => ({ resultIndex: 0, resultCount: 0, found: false }),
  clearSearch: () => {},
  writeInput: () => {},
  takeover: () => Promise.resolve(false),
}

/**
 * Module-level dedup of missing-context reports. A burst of N consumers
 * mounting under a missing provider would otherwise queue N toasts of the
 * same error. Track which kinds have already been surfaced so each kind
 * fires at most once per "burst" (an app start or a fresh
 * `__resetTerminalContextReporting`).
 *
 * Per-component `useRef` still exists in `useReportMissingContext` for
 * defense-in-depth and to keep StrictMode double-invoke behavior intact,
 * but the user-facing toast gate lives here.
 */
let reportedKinds: Set<'read' | 'command'> | null = null
function getReportedKinds(): Set<'read' | 'command'> {
  if (!reportedKinds) reportedKinds = new Set()
  return reportedKinds
}

/** Test-only: clear the missing-context dedup state between cases. */
export function __resetTerminalContextReporting(): void {
  reportedKinds = null
}

/**
 * Surface a missing context to the user (toast) and to devtools (log with
 * stack). Each `(kind, "burst")` pair fires at most once.
 */
function useReportMissingContext(kind: 'read' | 'command', value: unknown): void {
  const reportedRef = useRef(false)
  const t = useT()
  useEffect(() => {
    if (value !== null || reportedRef.current) return
    reportedRef.current = true
    const set = getReportedKinds()
    if (set.has(kind)) return
    set.add(kind)
    goblinLog.error(`terminal ${kind} context missing`, { stack: new Error().stack })
    toast.error(t('error.terminal-context-unavailable'), {
      description: t('error.terminal-context-unavailable-description'),
    })
  }, [value, kind, t])
}

export function useTerminalSessionContext(): TerminalSessionContextValue {
  const value = useContext(TerminalSessionContext)
  useReportMissingContext('command', value)
  return value ?? EMPTY_TERMINAL_COMMAND_CONTEXT_VALUE
}

export function useTerminalSessionReadContext(): TerminalSessionReadContextValue {
  const value = useContext(TerminalSessionReadContext)
  useReportMissingContext('read', value)
  return value ?? EMPTY_TERMINAL_READ_CONTEXT_VALUE
}