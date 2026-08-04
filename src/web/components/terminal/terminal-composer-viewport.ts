interface TerminalComposerViewportOptions {
  composer: HTMLElement
  container: HTMLElement
  terminalBottomMarker: HTMLElement
  visualViewport: VisualViewport
  getComposerInput: () => HTMLTextAreaElement | null
}

/**
 * Whenever the Composer input gains focus, it reveals the terminal bottom through this handle; while
 * the input remains focused, viewport and Composer size changes reestablish the same invariant.
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

function measureComposerHeight(composer: HTMLElement): number {
  return Math.ceil(composer.getBoundingClientRect().height)
}

function scrollTerminalBottomIntoView(marker: HTMLElement, height: number): void {
  marker.style.scrollMarginBlockStart = `${height}px`
  marker.scrollIntoView(SCROLL_INTO_VIEW_OPTIONS)
}

export function installTerminalComposerViewport(
  options: TerminalComposerViewportOptions,
): TerminalComposerViewportHandle {
  const viewportIsZoomed = () => Number.isFinite(options.visualViewport.scale) && options.visualViewport.scale !== 1
  const composerInputIsFocused = () => {
    const input = options.getComposerInput()
    return input !== null && input === input.ownerDocument.activeElement
  }
  let observedComposerHeight = measureComposerHeight(options.composer)
  const updateComposerPlacement = () => {
    const visibleBottom = options.visualViewport.offsetTop + options.visualViewport.height
    const obscuredHeight = Math.max(0, options.container.getBoundingClientRect().bottom - visibleBottom)
    options.composer.style.setProperty('--goblin-terminal-composer-keyboard-offset', `${Math.round(obscuredHeight)}px`)
  }
  const revealTerminalBottom = () => {
    observedComposerHeight = measureComposerHeight(options.composer)
    scrollTerminalBottomIntoView(options.terminalBottomMarker, observedComposerHeight)
    updateComposerPlacement()
  }
  const updateForViewportResize = () => {
    if (!viewportIsZoomed() && composerInputIsFocused()) {
      revealTerminalBottom()
      return
    }
    updateComposerPlacement()
  }
  const updateForComposerResize = () => {
    const nextComposerHeight = measureComposerHeight(options.composer)
    if (nextComposerHeight === observedComposerHeight) return
    if (!viewportIsZoomed() && composerInputIsFocused()) {
      revealTerminalBottom()
      return
    }
    observedComposerHeight = nextComposerHeight
  }

  updateComposerPlacement()
  options.visualViewport.addEventListener('resize', updateForViewportResize)
  options.visualViewport.addEventListener('scroll', updateComposerPlacement)
  const containerObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateComposerPlacement)
  const composerObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateForComposerResize)
  containerObserver?.observe(options.container)
  composerObserver?.observe(options.composer)

  return {
    revealTerminalBottom,
    dispose() {
      options.visualViewport.removeEventListener('resize', updateForViewportResize)
      options.visualViewport.removeEventListener('scroll', updateComposerPlacement)
      containerObserver?.disconnect()
      composerObserver?.disconnect()
    },
  }
}
