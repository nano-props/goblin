export type TerminalComposerSubmitStrategy = 'paste-then-enter' | 'typed-then-enter'

export interface TerminalComposerSubmitPlan {
  strategy: TerminalComposerSubmitStrategy
  payload: string
}

export function planTerminalComposerSubmit(input: { text: string; processName: string }): TerminalComposerSubmitPlan {
  if (input.processName.trim().toLowerCase() !== 'devin') {
    return { strategy: 'paste-then-enter', payload: input.text }
  }

  const normalizedText = input.text.replace(/\r\n?/g, '\n')
  return isSafeTypedTerminalText(normalizedText)
    ? { strategy: 'typed-then-enter', payload: normalizedText }
    : { strategy: 'paste-then-enter', payload: input.text }
}

function isSafeTypedTerminalText(text: string): boolean {
  if (!text) return false
  for (const character of text) {
    const codeUnit = character.charCodeAt(0)
    if (codeUnit <= 0x09 || (codeUnit >= 0x0b && codeUnit <= 0x1f) || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return false
    }
  }
  return true
}
