import { vi } from 'vitest'
import type { TerminalSessionContextValue } from '#/web/components/terminal/types.ts'

type TestTerminalSessionContextValue = Omit<
  TerminalSessionContextValue,
  | 'createTerminalWithAdmission'
  | 'captureInputWriter'
  | 'readCopyText'
  | 'sendVirtualKey'
  | 'submitText'
  | 'retryPresentation'
  | 'openComposer'
  | 'closeComposer'
  | 'setComposerMode'
  | 'setComposerDraft'
  | 'replaceComposerDraft'
> &
  Partial<
    Pick<
      TerminalSessionContextValue,
      | 'createTerminalWithAdmission'
      | 'captureInputWriter'
      | 'readCopyText'
      | 'sendVirtualKey'
      | 'submitText'
      | 'retryPresentation'
      | 'openComposer'
      | 'closeComposer'
      | 'setComposerMode'
      | 'setComposerDraft'
      | 'replaceComposerDraft'
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
  const readCopyText = context.readCopyText ?? unexpectedContextCapability('readCopyText')
  const sendVirtualKey = context.sendVirtualKey ?? unexpectedContextCapability('sendVirtualKey')
  const submitText = context.submitText ?? unexpectedContextCapability('submitText')
  const retryPresentation = context.retryPresentation ?? unexpectedContextCapability('retryPresentation')
  const openComposer = context.openComposer ?? unexpectedContextCapability('openComposer')
  const closeComposer = context.closeComposer ?? unexpectedContextCapability('closeComposer')
  const setComposerMode = context.setComposerMode ?? unexpectedContextCapability('setComposerMode')
  const setComposerDraft = context.setComposerDraft ?? unexpectedContextCapability('setComposerDraft')
  const replaceComposerDraft = context.replaceComposerDraft ?? unexpectedContextCapability('replaceComposerDraft')
  return {
    ...context,
    createTerminalWithAdmission,
    captureInputWriter,
    readCopyText,
    sendVirtualKey,
    submitText,
    retryPresentation,
    openComposer,
    closeComposer,
    setComposerMode,
    setComposerDraft,
    replaceComposerDraft,
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
