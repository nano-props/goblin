type TerminalViewportEventSource = (listener: () => void) => { dispose: () => void }

interface TerminalViewportRevealOptions {
  element: HTMLElement
  textarea: HTMLTextAreaElement
  visualViewport: VisualViewport
  onTerminalResize: TerminalViewportEventSource
  getLineHeight: () => number
  getCursorRow: () => number | null
}

interface TerminalInputBufferPosition {
  readonly type: 'normal' | 'alternate'
  readonly baseY: number
  readonly cursorY: number
  readonly viewportY: number
}

const TERMINAL_VIEWPORT_REVEAL_BOTTOM_ROWS = 4
const SCROLL_INTO_VIEW_OPTIONS: ScrollIntoViewOptions = {
  block: 'nearest',
  inline: 'nearest',
  behavior: 'auto',
}

export function terminalInputRevealRow(buffer: TerminalInputBufferPosition, rows: number): number | null {
  const viewportCursorRow = buffer.baseY + buffer.cursorY - buffer.viewportY
  if (viewportCursorRow >= 0 && viewportCursorRow < rows) return viewportCursorRow

  // Goblin configures xterm with scrollOnUserInput, so normal-buffer input returns to baseY. Project
  // that authoritative next-input position before the first key arrives instead of waiting for a
  // later browser viewport event that the internal xterm scroll does not produce.
  if (buffer.type === 'normal' && viewportCursorRow >= rows) return buffer.cursorY
  return null
}

export function installTerminalViewportReveal(options: TerminalViewportRevealOptions): { dispose: () => void } {
  const ownerWindow = options.textarea.ownerDocument.defaultView
  if (!ownerWindow) return { dispose: () => {} }

  // xterm's textarea position can lag behind resize and scrollback changes. Keep focus ownership there,
  // but derive page-reveal geometry from current public buffer state through this app-owned marker.
  const revealMarker = options.textarea.ownerDocument.createElement('span')
  revealMarker.setAttribute('aria-hidden', 'true')
  Object.assign(revealMarker.style, {
    position: 'absolute',
    left: '0',
    width: '1px',
    opacity: '0',
    pointerEvents: 'none',
  })
  options.element.appendChild(revealMarker)

  let pending = false
  let frameId: number | null = null
  const cancelPending = () => {
    pending = false
  }
  const applyPending = () => {
    if (!pending || options.textarea.ownerDocument.activeElement !== options.textarea) return

    const lineHeight = options.getLineHeight()
    const cursorRow = options.getCursorRow()
    if (!(lineHeight > 0) || !Number.isFinite(lineHeight) || cursorRow === null) return

    const revealMargin = Math.round(lineHeight * TERMINAL_VIEWPORT_REVEAL_BOTTOM_ROWS)
    revealMarker.style.top = `${cursorRow * lineHeight}px`
    revealMarker.style.height = `${lineHeight}px`
    revealMarker.style.scrollMarginBlockEnd = `${revealMargin}px`

    const visibleTop = options.visualViewport.offsetTop
    const visibleBottom = visibleTop + options.visualViewport.height
    const cursorTop = options.element.getBoundingClientRect().top + cursorRow * lineHeight
    const cursorBottom = cursorTop + lineHeight + revealMargin
    if (cursorTop >= visibleTop && cursorBottom <= visibleBottom) {
      // Keep the request pending so a later visual-viewport pan rechecks the focused input.
      return
    }

    pending = false
    // This browser-owned reveal is limited to explicit focus, pointer, visual-viewport, and
    // terminal-geometry requests. Terminal output cannot request it through cursor movement.
    revealMarker.scrollIntoView(SCROLL_INTO_VIEW_OPTIONS)
  }
  const schedulePending = () => {
    if (!pending || frameId !== null) return
    frameId = ownerWindow.requestAnimationFrame(() => {
      frameId = null
      applyPending()
    })
  }
  const requestReveal = () => {
    pending = true
    schedulePending()
  }
  const requestRevealWhileFocused = () => {
    if (options.textarea.ownerDocument.activeElement === options.textarea) requestReveal()
  }

  // Cursor movement is intentionally excluded: xterm also emits it for output parsing and redraws.
  // Only direct input intent and viewport geometry changes may request page reveal. A long wrapped
  // input can outgrow the four-row margin until the next explicit focus, pointer, or geometry event.
  options.textarea.addEventListener('focus', requestReveal)
  options.textarea.addEventListener('blur', cancelPending)
  options.element.addEventListener('pointerdown', requestReveal, { passive: true })
  options.visualViewport.addEventListener('resize', requestRevealWhileFocused)
  options.visualViewport.addEventListener('scroll', schedulePending)
  const terminalResizeSubscription = options.onTerminalResize(requestRevealWhileFocused)

  return {
    dispose: () => {
      pending = false
      if (frameId !== null) ownerWindow.cancelAnimationFrame(frameId)
      terminalResizeSubscription.dispose()
      options.textarea.removeEventListener('focus', requestReveal)
      options.textarea.removeEventListener('blur', cancelPending)
      options.element.removeEventListener('pointerdown', requestReveal)
      options.visualViewport.removeEventListener('resize', requestRevealWhileFocused)
      options.visualViewport.removeEventListener('scroll', schedulePending)
      revealMarker.remove()
    },
  }
}
