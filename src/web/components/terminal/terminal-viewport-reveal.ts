interface TerminalViewportRevealOptions {
  element: HTMLElement
  textarea: HTMLTextAreaElement
  visualViewport: VisualViewport
  getLineHeight: () => number
}

const TERMINAL_VIEWPORT_REVEAL_BOTTOM_ROWS = 3
const SCROLL_INTO_VIEW_OPTIONS: ScrollIntoViewOptions = {
  block: 'nearest',
  inline: 'nearest',
  behavior: 'auto',
}

export function installTerminalViewportReveal(options: TerminalViewportRevealOptions): { dispose: () => void } {
  const ownerWindow = options.textarea.ownerDocument.defaultView
  if (!ownerWindow) return { dispose: () => {} }

  const originalScrollMarginBlockEnd = options.textarea.style.scrollMarginBlockEnd
  let pending = false
  let frameId: number | null = null
  const cancelPending = () => {
    pending = false
  }
  const applyPending = () => {
    if (!pending || options.textarea.ownerDocument.activeElement !== options.textarea) return

    const visibleBottom = options.visualViewport.offsetTop + options.visualViewport.height
    const terminalRect = options.element.getBoundingClientRect()
    if (terminalRect.bottom <= visibleBottom) return

    // xterm keeps the textarea far offscreen until it synchronizes it with the rendered cursor.
    if (!options.textarea.style.left || !options.textarea.style.top || !options.textarea.style.height) return
    const cursorRect = options.textarea.getBoundingClientRect()
    if (!(cursorRect.height > 0) || cursorRect.right <= terminalRect.left || cursorRect.left >= terminalRect.right) {
      return
    }

    const lineHeight = options.getLineHeight()
    const revealMargin = Number.isFinite(lineHeight)
      ? Math.max(0, Math.round(lineHeight * TERMINAL_VIEWPORT_REVEAL_BOTTOM_ROWS))
      : 0
    pending = false
    if (cursorRect.bottom + revealMargin > visibleBottom) {
      if (revealMargin > 0) options.textarea.style.scrollMarginBlockEnd = `${revealMargin}px`
      options.textarea.scrollIntoView(SCROLL_INTO_VIEW_OPTIONS)
    }
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
  const rearmReveal = () => {
    pending = true
  }

  options.textarea.addEventListener('focus', requestReveal)
  options.textarea.addEventListener('blur', cancelPending)
  options.element.addEventListener('pointerdown', rearmReveal, { passive: true })
  options.visualViewport.addEventListener('resize', schedulePending)
  options.visualViewport.addEventListener('scroll', schedulePending)

  return {
    dispose: () => {
      pending = false
      if (frameId !== null) ownerWindow.cancelAnimationFrame(frameId)
      options.textarea.removeEventListener('focus', requestReveal)
      options.textarea.removeEventListener('blur', cancelPending)
      options.element.removeEventListener('pointerdown', rearmReveal)
      options.visualViewport.removeEventListener('resize', schedulePending)
      options.visualViewport.removeEventListener('scroll', schedulePending)
      options.textarea.style.scrollMarginBlockEnd = originalScrollMarginBlockEnd
    },
  }
}
