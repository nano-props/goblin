import {
  currentPrimaryWindowNavigationGeneration,
  primaryWindowNavigationIsCurrent,
  type PrimaryWindowNavigationGeneration,
} from '#/web/primary-window-navigation-lifecycle.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'

type FocusTerminal = (
  terminalSessionId: string,
  request: { isCurrent: () => boolean; onSettled: () => void },
) => boolean

export interface TerminalPresentationFocusEffects {
  onCommit(): void
  onAbandon(): void
}

export interface TerminalAutoFocusLease {
  commit(terminalSessionId: string, focusTerminal: FocusTerminal): void
  release(): void
}

interface TerminalAutoFocusIntent {
  generation: PrimaryWindowNavigationGeneration
  terminalSessionId: string | null
  phase: 'open' | 'submitted' | 'finished'
}

const terminalAutoFocusByDocument = new WeakMap<Document, TerminalAutoFocusIntent>()
const observedDocuments = new WeakSet<Document>()

/** Reserves one automatic-focus intent for a primary-window navigation. */
export function claimTerminalAutoFocus(generation: PrimaryWindowNavigationGeneration): TerminalAutoFocusLease | null {
  const ownerDocument = currentDocument()
  if (!ownerDocument || !primaryWindowNavigationIsCurrent(generation)) return null
  const existing = terminalAutoFocusByDocument.get(ownerDocument)
  if (existing?.generation === generation) return null

  observeExplicitFocusAbandon(ownerDocument)
  const intent: TerminalAutoFocusIntent = { generation, terminalSessionId: null, phase: 'open' }
  terminalAutoFocusByDocument.set(ownerDocument, intent)
  return {
    commit(terminalSessionId, focusTerminal) {
      if (!terminalAutoFocusIntentIsOpen(ownerDocument, intent)) return
      if (intent.terminalSessionId !== null && intent.terminalSessionId !== terminalSessionId) {
        finishTerminalAutoFocus(intent)
        return
      }
      intent.terminalSessionId = terminalSessionId
      submitTerminalAutoFocus(ownerDocument, intent, focusTerminal)
    },
    release() {
      finishTerminalAutoFocus(intent)
    },
  }
}

export function claimTerminalPresentationFocus(
  generation: PrimaryWindowNavigationGeneration,
  terminalSessionId: string,
): TerminalPresentationFocusEffects | null {
  const lease = claimTerminalAutoFocus(generation)
  if (!lease) return null
  let settled = false
  return {
    onCommit() {
      if (settled) return
      settled = true
      lease.commit(terminalSessionId, (sessionId, request) => {
        const bridge = readTerminalSessionCommandBridge()
        return bridge ? bridge.focusTerminal(sessionId, request) : false
      })
    },
    onAbandon() {
      if (settled) return
      settled = true
      lease.release()
    },
  }
}

/** Fulfils the current navigation's intent when the selected terminal mounts. */
export function fulfillTerminalPresentationFocus(terminalSessionId: string, focusTerminal: FocusTerminal): void {
  const ownerDocument = currentDocument()
  if (!ownerDocument) return
  const generation = currentPrimaryWindowNavigationGeneration()
  const existing = terminalAutoFocusByDocument.get(ownerDocument)
  if (existing?.generation === generation) {
    if (existing.terminalSessionId === terminalSessionId && existing.phase === 'open') {
      submitTerminalAutoFocus(ownerDocument, existing, focusTerminal)
    }
    return
  }
  if (!documentFocusIsNeutral(ownerDocument)) return
  claimTerminalAutoFocus(generation)?.commit(terminalSessionId, focusTerminal)
}

export function terminalHasKeyboardFocus(): boolean {
  const activeElement =
    typeof document !== 'undefined' && typeof HTMLElement !== 'undefined' ? document.activeElement : null
  return activeElement instanceof HTMLElement && !!activeElement.closest('.goblin-managed-terminal-host')
}

/** Cancels automatic focus when another UI explicitly takes focus ownership. */
export function cancelTerminalAutoFocus(): void {
  const ownerDocument = currentDocument()
  const intent = ownerDocument ? terminalAutoFocusByDocument.get(ownerDocument) : null
  if (intent) finishTerminalAutoFocus(intent)
}

export function resetTerminalAutoFocusForTest(): void {
  const ownerDocument = currentDocument()
  if (ownerDocument) terminalAutoFocusByDocument.delete(ownerDocument)
}

function submitTerminalAutoFocus(
  ownerDocument: Document,
  intent: TerminalAutoFocusIntent,
  focusTerminal: FocusTerminal,
): void {
  if (!terminalAutoFocusIntentIsOpen(ownerDocument, intent) || intent.terminalSessionId === null) return
  const isCurrent = () =>
    intent.phase === 'submitted' &&
    terminalAutoFocusByDocument.get(ownerDocument) === intent &&
    primaryWindowNavigationIsCurrent(intent.generation)
  const onSettled = () => finishTerminalAutoFocus(intent)
  intent.phase = 'submitted'
  try {
    // Presentation readiness is the focus boundary. Waiting for keyup here
    // would recreate a global keyboard gate; a held key may follow focus.
    if (focusTerminal(intent.terminalSessionId, { isCurrent, onSettled })) return
  } catch (error) {
    finishTerminalAutoFocus(intent)
    throw error
  }
  if (intent.phase === 'submitted') intent.phase = 'open'
}

function terminalAutoFocusIntentIsOpen(ownerDocument: Document, intent: TerminalAutoFocusIntent): boolean {
  if (
    intent.phase === 'open' &&
    terminalAutoFocusByDocument.get(ownerDocument) === intent &&
    primaryWindowNavigationIsCurrent(intent.generation)
  ) {
    return true
  }
  finishTerminalAutoFocus(intent)
  return false
}

function finishTerminalAutoFocus(intent: TerminalAutoFocusIntent): void {
  intent.phase = 'finished'
}

function observeExplicitFocusAbandon(ownerDocument: Document): void {
  if (observedDocuments.has(ownerDocument)) return
  observedDocuments.add(ownerDocument)
  const abandon = () => {
    const intent = terminalAutoFocusByDocument.get(ownerDocument)
    if (intent) finishTerminalAutoFocus(intent)
  }
  const abandonForKeyboardNavigation = (event: KeyboardEvent) => {
    if (event.key === 'Tab') abandon()
  }
  ownerDocument.addEventListener('pointerdown', abandon, true)
  ownerDocument.addEventListener('keydown', abandonForKeyboardNavigation, true)
  ownerDocument.defaultView?.addEventListener('blur', abandon)
}

function documentFocusIsNeutral(ownerDocument: Document): boolean {
  return (
    ownerDocument.activeElement === null ||
    ownerDocument.activeElement === ownerDocument.body ||
    ownerDocument.activeElement === ownerDocument.documentElement
  )
}

function currentDocument(): Document | null {
  return typeof document === 'undefined' ? null : document
}
