import { vi } from 'vitest'
import type { TerminalSessionContextValue } from '#/web/components/terminal/types.ts'

type TestTerminalSessionContextValue = Omit<
  TerminalSessionContextValue,
  | 'createTerminalWithAdmission'
  | 'captureInputWriter'
  | 'sendVirtualKey'
  | 'submitText'
  | 'retryPresentation'
  | 'setComposerExpanded'
  | 'setComposerMode'
> &
  Partial<
    Pick<
      TerminalSessionContextValue,
      | 'createTerminalWithAdmission'
      | 'captureInputWriter'
      | 'sendVirtualKey'
      | 'submitText'
      | 'retryPresentation'
      | 'setComposerExpanded'
      | 'setComposerMode'
    >
  >
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
  const sendVirtualKey = context.sendVirtualKey ?? unexpectedContextCapability('sendVirtualKey')
  const submitText = context.submitText ?? unexpectedContextCapability('submitText')
  const retryPresentation = context.retryPresentation ?? unexpectedContextCapability('retryPresentation')
  const setComposerExpanded = context.setComposerExpanded ?? unexpectedContextCapability('setComposerExpanded')
  const setComposerMode = context.setComposerMode ?? unexpectedContextCapability('setComposerMode')
  return {
    ...context,
    createTerminalWithAdmission,
    captureInputWriter,
    sendVirtualKey,
    submitText,
    retryPresentation,
    setComposerExpanded,
    setComposerMode,
  }
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
