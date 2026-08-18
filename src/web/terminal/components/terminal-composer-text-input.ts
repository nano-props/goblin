export type TerminalComposerTextInputMethod = 'paste' | 'typed'

export interface TerminalComposerTextInputPlan {
  method: TerminalComposerTextInputMethod
  payload: string
}

export function planTerminalComposerTextInput(input: {
  text: string
  processName: string
}): TerminalComposerTextInputPlan {
  if (input.processName.trim().toLowerCase() !== 'devin') {
    return { method: 'paste', payload: input.text }
  }

  const normalizedText = input.text.replace(/\r\n?/g, '\n')
  return isSafeTypedTerminalText(normalizedText)
    ? { method: 'typed', payload: normalizedText }
    : { method: 'paste', payload: input.text }
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
