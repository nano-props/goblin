import { vi } from 'vitest'
import {
  setTerminalSessionCommandBridge as setTerminalSessionCommandBridgeBase,
  type TerminalSessionCommandBridge,
} from '#/web/components/terminal/terminal-session-command-bridge.ts'

type TestTerminalSessionCommandBridge = Omit<
  TerminalSessionCommandBridge,
  'createTerminalWithAdmission' | 'focusTerminal'
> & {
  createTerminalWithAdmission?: TerminalSessionCommandBridge['createTerminalWithAdmission']
  focusTerminal?: TerminalSessionCommandBridge['focusTerminal']
}
type CreatedAdmissionTestTerminalSessionCommandBridge = Omit<
  TestTerminalSessionCommandBridge,
  'createTerminalWithAdmission'
>

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
    next.createTerminalWithAdmission ?? unexpectedBridgeCapability('createTerminalWithAdmission')
  const focusTerminal = next.focusTerminal ?? unexpectedBridgeCapability('focusTerminal')
  return setTerminalSessionCommandBridgeBase({ ...next, createTerminalWithAdmission, focusTerminal })
}

/** Explicit adapter for tests whose legacy create callback represents one successful new-session admission. */
export function setTerminalSessionCommandBridgeWithCreatedAdmissionForTest(
  next: CreatedAdmissionTestTerminalSessionCommandBridge | null,
): () => void {
  if (!next) return setTerminalSessionCommandBridgeForTest(null)
  return setTerminalSessionCommandBridgeForTest({
    ...next,
    createTerminalWithAdmission: createTerminalWithAdmissionForTest(next.createTerminal),
  })
}

function unexpectedBridgeCapability(name: keyof TerminalSessionCommandBridge): () => never {
  return () => {
    throw new Error(`Unexpected terminal session command bridge capability in test: ${name}`)
  }
}
