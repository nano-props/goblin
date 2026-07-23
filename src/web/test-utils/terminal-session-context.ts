import { vi } from 'vitest'
import type { TerminalSessionContextValue } from '#/web/components/terminal/types.ts'

type TestTerminalSessionContextValue = Omit<
  TerminalSessionContextValue,
  'createTerminalWithAdmission' | 'captureInputWriter'
> &
  Partial<Pick<TerminalSessionContextValue, 'createTerminalWithAdmission' | 'captureInputWriter'>>
type CreatedAdmissionTestTerminalSessionContextValue = Omit<
  TestTerminalSessionContextValue,
  'createTerminalWithAdmission'
>

export function createTerminalWithAdmissionForContextTest(
  createTerminal: TerminalSessionContextValue['createTerminal'],
): TerminalSessionContextValue['createTerminalWithAdmission'] {
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

export function terminalSessionContextForTest(context: TestTerminalSessionContextValue): TerminalSessionContextValue {
  const createTerminalWithAdmission =
    context.createTerminalWithAdmission ?? unexpectedContextCapability('createTerminalWithAdmission')
  const captureInputWriter = context.captureInputWriter ?? unexpectedContextCapability('captureInputWriter')
  return { ...context, createTerminalWithAdmission, captureInputWriter }
}

/** Explicit adapter for tests whose create callback represents one successful new-session admission. */
export function terminalSessionContextWithCreatedAdmissionForTest(
  context: CreatedAdmissionTestTerminalSessionContextValue,
): TerminalSessionContextValue {
  return terminalSessionContextForTest({
    ...context,
    createTerminalWithAdmission: createTerminalWithAdmissionForContextTest(context.createTerminal),
  })
}

function unexpectedContextCapability(name: keyof TerminalSessionContextValue): () => never {
  return () => {
    throw new Error(`Unexpected terminal session context capability in test: ${name}`)
  }
}
