import {
  currentPrimaryWindowPresentationToken,
  primaryWindowPresentationIsCurrent,
  registerPrimaryWindowPresentationAbandon,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'
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

interface TerminalAutoFocusRecord {
  token: PrimaryWindowPresentationToken
  terminalSessionId: string | null
  state: 'claimed' | 'pending' | 'accepted' | 'settled' | 'abandoned'
  releaseAbandonObservation: () => void
  releasePresentationAbandon: () => void
}

// One document has at most one automatic-focus intent for a presentation
// generation. A settled record deliberately remains until the next generation
// so a remount cannot recreate and replay the same intent.
const terminalAutoFocusByDocument = new WeakMap<Document, TerminalAutoFocusRecord>()

/**
 * Records an app-owned intent to focus the terminal selected by a navigation.
 * It does not move DOM focus or intercept keyboard input. The selected session
 * fulfils the intent only after its own presentation boundary admits focus.
 */
export function claimTerminalAutoFocus(token: PrimaryWindowPresentationToken): TerminalAutoFocusLease | null {
  const ownerDocument = currentDocument()
  if (!ownerDocument || !primaryWindowPresentationIsCurrent(token)) return null
  const existing = terminalAutoFocusByDocument.get(ownerDocument)
  if (existing?.token.generation === token.generation) return null

  const record: TerminalAutoFocusRecord = {
    token,
    terminalSessionId: null,
    state: 'claimed',
    releaseAbandonObservation: () => {},
    releasePresentationAbandon: () => {},
  }
  terminalAutoFocusByDocument.set(ownerDocument, record)
  record.releasePresentationAbandon = registerPrimaryWindowPresentationAbandon(token, () => {
    abandonTerminalAutoFocus(record)
  })
  if (record.state === 'abandoned') return null
  record.releaseAbandonObservation = observeAutoFocusAbandon(ownerDocument, record)

  return {
    commit(terminalSessionId, focusTerminal) {
      commitTerminalAutoFocus(ownerDocument, record, terminalSessionId, focusTerminal)
    },
    release() {
      abandonTerminalAutoFocus(record)
    },
  }
}

export function claimTerminalPresentationFocus(
  token: PrimaryWindowPresentationToken,
  terminalSessionId: string,
): TerminalPresentationFocusEffects | null {
  const lease = claimTerminalAutoFocus(token)
  if (!lease) return null
  let transferred = false
  return {
    onCommit() {
      if (transferred) return
      transferred = true
      lease.commit(terminalSessionId, (sessionId, request) => {
        const bridge = readTerminalSessionCommandBridge()
        return bridge ? bridge.focusTerminal(sessionId, request) : false
      })
    },
    onAbandon() {
      if (transferred) return
      transferred = true
      lease.release()
    },
  }
}

/**
 * Fulfils the current generation's focus intent when its xterm mounts. An
 * initial terminal URL has no app-owned navigation intent, so it may create one
 * only while focus is still on the neutral document surface.
 */
export function fulfillTerminalPresentationFocus(terminalSessionId: string, focusTerminal: FocusTerminal): void {
  const ownerDocument = currentDocument()
  if (!ownerDocument) return
  const token = currentPrimaryWindowPresentationToken()
  const existing = terminalAutoFocusByDocument.get(ownerDocument)
  if (existing?.token.generation === token.generation) {
    if (existing.terminalSessionId === terminalSessionId && existing.state === 'pending') {
      submitTerminalAutoFocus(ownerDocument, existing, focusTerminal)
    }
    return
  }
  if (!documentFocusIsNeutral(ownerDocument)) return
  claimTerminalAutoFocus(token)?.commit(terminalSessionId, focusTerminal)
}

export function terminalHasKeyboardFocus(): boolean {
  const activeElement =
    typeof document !== 'undefined' && typeof HTMLElement !== 'undefined' ? document.activeElement : null
  return activeElement instanceof HTMLElement && !!activeElement.closest('.goblin-managed-terminal-host')
}

/** Cancels automatic focus when another UI explicitly takes focus ownership. */
export function cancelTerminalAutoFocus(): void {
  const ownerDocument = currentDocument()
  if (!ownerDocument) return
  const record = terminalAutoFocusByDocument.get(ownerDocument)
  if (record) abandonTerminalAutoFocus(record)
}

export function resetTerminalAutoFocusForTest(): void {
  const ownerDocument = currentDocument()
  if (!ownerDocument) return
  const record = terminalAutoFocusByDocument.get(ownerDocument)
  if (record) abandonTerminalAutoFocus(record)
  terminalAutoFocusByDocument.delete(ownerDocument)
}

function commitTerminalAutoFocus(
  ownerDocument: Document,
  record: TerminalAutoFocusRecord,
  terminalSessionId: string,
  focusTerminal: FocusTerminal,
): void {
  if (record.state !== 'claimed' && record.state !== 'pending') return
  if (!terminalAutoFocusIsCurrent(ownerDocument, record)) {
    abandonTerminalAutoFocus(record)
    return
  }
  if (record.terminalSessionId !== null && record.terminalSessionId !== terminalSessionId) {
    abandonTerminalAutoFocus(record)
    return
  }
  record.terminalSessionId = terminalSessionId
  submitTerminalAutoFocus(ownerDocument, record, focusTerminal)
}

function submitTerminalAutoFocus(
  ownerDocument: Document,
  record: TerminalAutoFocusRecord,
  focusTerminal: FocusTerminal,
): void {
  if ((record.state !== 'claimed' && record.state !== 'pending') || record.terminalSessionId === null) return
  if (!terminalAutoFocusIsCurrent(ownerDocument, record)) {
    abandonTerminalAutoFocus(record)
    return
  }
  const isCurrent = () => record.state === 'accepted' && terminalAutoFocusIsCurrent(ownerDocument, record)
  const onSettled = () => {
    if (record.state !== 'accepted') return
    settleTerminalAutoFocus(record)
  }
  record.state = 'accepted'
  try {
    if (focusTerminal(record.terminalSessionId, { isCurrent, onSettled })) return
  } catch (error) {
    abandonTerminalAutoFocus(record)
    throw error
  }
  if (record.state === 'accepted') record.state = 'pending'
}

function observeAutoFocusAbandon(ownerDocument: Document, record: TerminalAutoFocusRecord): () => void {
  let disposed = false
  let installed = false
  const abandon = () => abandonTerminalAutoFocus(record)
  // The action that claimed the intent may itself be handling a pointer event.
  // Start observing after that dispatch so only a later pointer intent cancels it.
  queueMicrotask(() => {
    if (disposed || !terminalAutoFocusIsCurrent(ownerDocument, record)) return
    installed = true
    ownerDocument.addEventListener('pointerdown', abandon, true)
    ownerDocument.defaultView?.addEventListener('blur', abandon)
  })
  return () => {
    disposed = true
    if (!installed) return
    ownerDocument.removeEventListener('pointerdown', abandon, true)
    ownerDocument.defaultView?.removeEventListener('blur', abandon)
  }
}

function terminalAutoFocusIsCurrent(ownerDocument: Document, record: TerminalAutoFocusRecord): boolean {
  return terminalAutoFocusByDocument.get(ownerDocument) === record && primaryWindowPresentationIsCurrent(record.token)
}

function settleTerminalAutoFocus(record: TerminalAutoFocusRecord): void {
  record.state = 'settled'
  releaseTerminalAutoFocus(record)
}

function abandonTerminalAutoFocus(record: TerminalAutoFocusRecord): void {
  if (record.state === 'settled' || record.state === 'abandoned') return
  record.state = 'abandoned'
  releaseTerminalAutoFocus(record)
}

function releaseTerminalAutoFocus(record: TerminalAutoFocusRecord): void {
  record.releaseAbandonObservation()
  record.releaseAbandonObservation = () => {}
  record.releasePresentationAbandon()
  record.releasePresentationAbandon = () => {}
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
