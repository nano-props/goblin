export type TerminalComposerEditCommand = 'word' | 'line'

interface TerminalComposerEditKeyboardEvent {
  code?: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export function terminalComposerEditCommandForEvent(
  event: TerminalComposerEditKeyboardEvent,
  isDesktopMac: boolean,
): TerminalComposerEditCommand | null {
  if (!isDesktopMac || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null
  if (event.code === 'KeyW') return 'word'
  if (event.code === 'KeyU') return 'line'
  return null
}

export interface TerminalComposerEditPlan {
  start: number
  end: number
  value: string
  caret: number
}

export function textareaOffsetToDraftOffset(value: string, textareaOffset: number): number {
  const target = Math.max(0, textareaOffset)
  let normalizedOffset = 0
  for (let index = 0; index < value.length; index += 1) {
    if (normalizedOffset >= target) return index
    if (value[index] === '\r') {
      if (value[index + 1] === '\n') index += 1
    }
    normalizedOffset += 1
  }
  return value.length
}

export function draftOffsetToTextareaOffset(value: string, draftOffset: number): number {
  const target = Math.max(0, Math.min(draftOffset, value.length))
  let normalizedOffset = 0
  for (let index = 0; index < value.length; index += 1) {
    if (index >= target) return normalizedOffset
    if (value[index] === '\r') {
      if (value[index + 1] === '\n') {
        if (index + 1 >= target) return normalizedOffset
        index += 1
      }
    }
    normalizedOffset += 1
  }
  return normalizedOffset
}

function isHardLineBoundary(character: string | undefined): boolean {
  return character === '\n' || character === '\r'
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character !== undefined && !isHardLineBoundary(character) && /\s/u.test(character)
}

export function planTerminalComposerEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: TerminalComposerEditCommand,
): TerminalComposerEditPlan {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))

  if (start !== end) {
    return { start, end, value: `${value.slice(0, start)}${value.slice(end)}`, caret: start }
  }

  let deletionStart = start
  if (command === 'line') {
    while (deletionStart > 0 && !isHardLineBoundary(value[deletionStart - 1])) deletionStart -= 1
  } else {
    while (deletionStart > 0 && isHorizontalWhitespace(value[deletionStart - 1])) deletionStart -= 1
    while (
      deletionStart > 0 &&
      !isHardLineBoundary(value[deletionStart - 1]) &&
      !isHorizontalWhitespace(value[deletionStart - 1])
    ) {
      deletionStart -= 1
    }
  }

  return {
    start: deletionStart,
    end: start,
    value: `${value.slice(0, deletionStart)}${value.slice(start)}`,
    caret: deletionStart,
  }
}
