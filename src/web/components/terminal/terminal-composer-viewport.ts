interface TerminalComposerViewportOptions {
  container: HTMLElement
  visualViewport: VisualViewport
}

export interface TerminalComposerViewportHandle {
  activate(input: HTMLTextAreaElement): void
  reset(): void
  dispose(): void
}

const PRESENTATION_TRANSFORM_PROPERTY = '--goblin-terminal-presentation-transform'

export function installTerminalComposerViewport(
  options: TerminalComposerViewportOptions,
): TerminalComposerViewportHandle {
  const ownerWindow = options.container.ownerDocument.defaultView
  let activeInput: HTMLTextAreaElement | null = null
  let listenersActive = false
  let containerObserver: ResizeObserver | null = null
  let appliedInset = ''
  const setInset = (inset: string) => {
    if (appliedInset === inset) return
    appliedInset = inset
    options.container.style.setProperty(
      PRESENTATION_TRANSFORM_PROPERTY,
      inset === '0px' ? 'none' : `translateY(-${inset})`,
    )
  }
  const resetInset = () => {
    setInset('0px')
  }
  const addListeners = () => {
    if (listenersActive) return
    listenersActive = true
    options.visualViewport.addEventListener('resize', updateInset)
    options.visualViewport.addEventListener('scroll', updateInset)
    ownerWindow?.addEventListener('scroll', updateInset, true)
    if (typeof ResizeObserver !== 'undefined') {
      containerObserver = new ResizeObserver(updateInset)
      containerObserver.observe(options.container)
    }
  }
  const removeListeners = () => {
    if (!listenersActive) return
    listenersActive = false
    options.visualViewport.removeEventListener('resize', updateInset)
    options.visualViewport.removeEventListener('scroll', updateInset)
    ownerWindow?.removeEventListener('scroll', updateInset, true)
    containerObserver?.disconnect()
    containerObserver = null
  }
  const updateInset = () => {
    if (
      !activeInput ||
      activeInput !== activeInput.ownerDocument.activeElement ||
      (Number.isFinite(options.visualViewport.scale) && options.visualViewport.scale !== 1)
    ) {
      resetInset()
      return
    }

    const viewportBottom = options.visualViewport.offsetTop + options.visualViewport.height
    const obscuredHeight = Math.max(0, options.container.getBoundingClientRect().bottom - viewportBottom)
    setInset(`${Math.round(obscuredHeight)}px`)
  }
  const activate = (input: HTMLTextAreaElement) => {
    activeInput = input
    addListeners()
    updateInset()
  }
  const reset = () => {
    activeInput = null
    removeListeners()
    resetInset()
  }

  resetInset()

  return {
    activate,
    reset,
    dispose() {
      reset()
    },
  }
}
