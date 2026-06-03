let focused = false

export function setTerminalFocused(value: boolean): void {
  focused = value
}

export function isTerminalFocused(): boolean {
  if (typeof document !== 'undefined' && typeof HTMLElement !== 'undefined') {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      return !!activeElement.closest('.goblin-managed-terminal-host')
    }
  }
  return focused
}
