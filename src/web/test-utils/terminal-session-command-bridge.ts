import { vi } from 'vitest'
import {
  setTerminalSessionCommandBridge as setTerminalSessionCommandBridgeBase,
  type TerminalSessionCommandBridge,
} from '#/web/components/terminal/terminal-session-command-bridge.ts'

type TestTerminalSessionCommandBridge = Omit<TerminalSessionCommandBridge, 'createTerminalWithAdmission'> &
  Partial<Pick<TerminalSessionCommandBridge, 'createTerminalWithAdmission'>>

export function createTerminalWithAdmissionForTest(
  createTerminal: TerminalSessionCommandBridge['createTerminal'],
): TerminalSessionCommandBridge['createTerminalWithAdmission'] {
  return vi.fn(async (base, options) => {
    const terminalSessionId = await createTerminal(base, options)
    return {
      terminalSessionId,
      presentation: base.presentation,
      requestRole: 'leader' as const,
      resourceDisposition: 'created' as const,
      runtimeProjectionApplied: true,
    }
  })
}

export function setTerminalSessionCommandBridgeForTest(next: TestTerminalSessionCommandBridge | null): () => void {
  if (!next) return setTerminalSessionCommandBridgeBase(null)
  const createTerminalWithAdmission =
    next.createTerminalWithAdmission ?? createTerminalWithAdmissionForTest(next.createTerminal)
  return setTerminalSessionCommandBridgeBase({ ...next, createTerminalWithAdmission })
}
