interface TerminalComposerViewportOptions {
  composer: HTMLElement
  container: HTMLElement
  terminalBottomMarker: HTMLElement
  visualViewport: VisualViewport
  getComposerInput: () => HTMLTextAreaElement | null
}

/**
 * Whenever the Composer input gains focus, it reveals the terminal bottom through this handle; while
 * the input remains focused, visual-viewport resizes reestablish the same invariant.
 */
export interface TerminalComposerViewportHandle {
  revealTerminalBottom(): void
  dispose(): void
}

const SCROLL_INTO_VIEW_OPTIONS: ScrollIntoViewOptions = {
  block: 'nearest',
  inline: 'nearest',
  behavior: 'auto',
}

function scrollTerminalBottomIntoView(marker: HTMLElement): void {
  marker.scrollIntoView(SCROLL_INTO_VIEW_OPTIONS)
}

export function installTerminalComposerViewport(
  options: TerminalComposerViewportOptions,
): TerminalComposerViewportHandle {
  const viewportIsZoomed = () => Number.isFinite(options.visualViewport.scale) && options.visualViewport.scale !== 1
  const updateComposerPlacement = () => {
    const visibleBottom = options.visualViewport.offsetTop + options.visualViewport.height
    const obscuredHeight = Math.max(0, options.container.getBoundingClientRect().bottom - visibleBottom)
    options.composer.style.setProperty('--goblin-terminal-composer-keyboard-offset', `${Math.round(obscuredHeight)}px`)
  }
  const revealTerminalBottom = () => {
    scrollTerminalBottomIntoView(options.terminalBottomMarker)
    updateComposerPlacement()
  }
  const updateForViewportResize = () => {
    const input = options.getComposerInput()
    if (!viewportIsZoomed() && input && input === input.ownerDocument.activeElement) {
      revealTerminalBottom()
      return
    }
    updateComposerPlacement()
  }

  updateComposerPlacement()
  options.visualViewport.addEventListener('resize', updateForViewportResize)
  options.visualViewport.addEventListener('scroll', updateComposerPlacement)
  const containerObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateComposerPlacement)
  containerObserver?.observe(options.container)

  return {
    revealTerminalBottom,
    dispose() {
      options.visualViewport.removeEventListener('resize', updateForViewportResize)
      options.visualViewport.removeEventListener('scroll', updateComposerPlacement)
      containerObserver?.disconnect()
    },
  }
}
