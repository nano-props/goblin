import { vi } from 'vitest'
import type { TerminalSessionContextValue } from '#/web/components/terminal/types.ts'

type TestTerminalSessionContextValue = Omit<TerminalSessionContextValue, 'createTerminalWithAdmission'> &
  Partial<Pick<TerminalSessionContextValue, 'createTerminalWithAdmission'>>

export function createTerminalWithAdmissionForContextTest(
  createTerminal: TerminalSessionContextValue['createTerminal'],
): TerminalSessionContextValue['createTerminalWithAdmission'] {
  return vi.fn(async (base, options) => {
    const terminalSessionId = await createTerminal(base, options)
    return {
      terminalSessionId,
      branch: base.branch,
      requestRole: 'leader' as const,
      resourceDisposition: 'created' as const,
      runtimeProjectionApplied: true,
    }
  })
}

export function terminalSessionContextForTest(context: TestTerminalSessionContextValue): TerminalSessionContextValue {
  const createTerminalWithAdmission =
    context.createTerminalWithAdmission ?? createTerminalWithAdmissionForContextTest(context.createTerminal)
  return { ...context, createTerminalWithAdmission }
}
