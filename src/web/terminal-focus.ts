import {
  currentPrimaryWindowPresentationToken,
  primaryWindowPresentationIsCurrent,
  registerPrimaryWindowPresentationAbandon,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'

export const TERMINAL_INPUT_FOCUS_SINK_ID = 'goblin-terminal-input-focus-sink'

type FocusTerminal = (
  terminalSessionId: string,
  request: { isCurrent: () => boolean; onSettled: () => void },
) => boolean

export interface TerminalInputFocusLease {
  commit(terminalSessionId: string, focusTerminal: FocusTerminal): void
  release(): void
}

export interface TerminalPresentationFocusEffects {
  onCommit(): void
  onAbandon(): void
}

interface TerminalInputFocusRecord {
  token: PrimaryWindowPresentationToken
  terminalSessionId: string | null
  state: 'claimed' | 'pending' | 'accepted' | 'settled' | 'abandoned'
  releasePresentationAbandon: () => void
}

// One sink has at most one focus intent for a presentation generation. A
// settled record deliberately remains until the next generation so a remount
// cannot recreate and replay the same intent.
const terminalInputFocusBySink = new WeakMap<HTMLElement, TerminalInputFocusRecord>()

/**
 * Claims keyboard ownership for an app-owned terminal navigation. Calling this
 * is the admission boundary that may move focus to the hidden sink; later
 * mount/render code can only fulfil this record.
 */
export function claimTerminalInputFocus(token: PrimaryWindowPresentationToken): TerminalInputFocusLease | null {
  const sink = terminalInputFocusSink()
  if (!sink || !primaryWindowPresentationIsCurrent(token)) return null
  const existing = terminalInputFocusBySink.get(sink)
  if (existing?.token.generation === token.generation) return null

  const record: TerminalInputFocusRecord = {
    token,
    terminalSessionId: null,
    state: 'claimed',
    releasePresentationAbandon: () => {},
  }
  terminalInputFocusBySink.set(sink, record)
  sink.focus({ preventScroll: true })
  if (document.activeElement !== sink) {
    abandonTerminalInputFocus(sink, record)
    return null
  }
  record.releasePresentationAbandon = registerPrimaryWindowPresentationAbandon(token, () => {
    abandonTerminalInputFocus(sink, record)
  })
  if (record.state === 'abandoned') return null

  return {
    commit(terminalSessionId, focusTerminal) {
      commitTerminalInputFocus(sink, record, terminalSessionId, focusTerminal)
    },
    release() {
      abandonTerminalInputFocus(sink, record)
    },
  }
}

export function claimTerminalPresentationFocus(
  token: PrimaryWindowPresentationToken,
  terminalSessionId: string,
): TerminalPresentationFocusEffects | null {
  const lease = claimTerminalInputFocus(token)
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
 * Fulfils the current generation's admitted focus intent when its xterm mounts.
 * An initial terminal URL has no app-owned navigation admission, so it may
 * create one intent only while focus is still on the neutral document surface.
 */
export function fulfillTerminalPresentationFocus(terminalSessionId: string, focusTerminal: FocusTerminal): void {
  const sink = terminalInputFocusSink()
  if (!sink) return
  const token = currentPrimaryWindowPresentationToken()
  const existing = terminalInputFocusBySink.get(sink)
  if (existing?.token.generation === token.generation) {
    if (existing.terminalSessionId === terminalSessionId && existing.state === 'pending') {
      submitTerminalInputFocus(sink, existing, focusTerminal)
    }
    return
  }
  if (!documentFocusIsNeutral()) return
  claimTerminalInputFocus(token)?.commit(terminalSessionId, focusTerminal)
}

export function terminalOwnsKeyboardInput(): boolean {
  const activeElement =
    typeof document !== 'undefined' && typeof HTMLElement !== 'undefined' ? document.activeElement : null
  if (!(activeElement instanceof HTMLElement)) return false
  if (activeElement.closest('.goblin-managed-terminal-host')) return true
  if (activeElement.id !== TERMINAL_INPUT_FOCUS_SINK_ID) return false
  const record = terminalInputFocusBySink.get(activeElement)
  return (
    !!record &&
    record.state !== 'settled' &&
    record.state !== 'abandoned' &&
    primaryWindowPresentationIsCurrent(record.token)
  )
}

function commitTerminalInputFocus(
  sink: HTMLElement,
  record: TerminalInputFocusRecord,
  terminalSessionId: string,
  focusTerminal: FocusTerminal,
): void {
  if (record.state !== 'claimed' && record.state !== 'pending') return
  if (!terminalInputFocusIsCurrent(sink, record)) {
    abandonTerminalInputFocus(sink, record)
    return
  }
  if (record.terminalSessionId !== null && record.terminalSessionId !== terminalSessionId) {
    abandonTerminalInputFocus(sink, record)
    return
  }
  record.terminalSessionId = terminalSessionId
  submitTerminalInputFocus(sink, record, focusTerminal)
}

function submitTerminalInputFocus(
  sink: HTMLElement,
  record: TerminalInputFocusRecord,
  focusTerminal: FocusTerminal,
): void {
  if ((record.state !== 'claimed' && record.state !== 'pending') || record.terminalSessionId === null) return
  if (!terminalInputFocusIsCurrent(sink, record)) {
    abandonTerminalInputFocus(sink, record)
    return
  }
  const isCurrent = () => record.state === 'accepted' && terminalInputFocusIsCurrent(sink, record)
  const onSettled = () => {
    if (record.state !== 'accepted') return
    settleTerminalInputFocus(sink, record)
  }
  record.state = 'accepted'
  try {
    if (focusTerminal(record.terminalSessionId, { isCurrent, onSettled })) return
  } catch (error) {
    abandonTerminalInputFocus(sink, record)
    throw error
  }
  if (record.state === 'accepted') record.state = 'pending'
}

function terminalInputFocusIsCurrent(sink: HTMLElement, record: TerminalInputFocusRecord): boolean {
  return (
    terminalInputFocusBySink.get(sink) === record &&
    primaryWindowPresentationIsCurrent(record.token) &&
    document.activeElement === sink
  )
}

function settleTerminalInputFocus(sink: HTMLElement, record: TerminalInputFocusRecord): void {
  record.state = 'settled'
  record.releasePresentationAbandon()
  record.releasePresentationAbandon = () => {}
  if (terminalInputFocusBySink.get(sink) === record && document.activeElement === sink) sink.blur()
}

function abandonTerminalInputFocus(sink: HTMLElement, record: TerminalInputFocusRecord): void {
  if (record.state === 'settled' || record.state === 'abandoned') return
  record.state = 'abandoned'
  record.releasePresentationAbandon()
  record.releasePresentationAbandon = () => {}
  if (terminalInputFocusBySink.get(sink) === record && document.activeElement === sink) sink.blur()
}

function documentFocusIsNeutral(): boolean {
  if (typeof document === 'undefined') return false
  return (
    document.activeElement === null ||
    document.activeElement === document.body ||
    document.activeElement === document.documentElement
  )
}

function terminalInputFocusSink(): HTMLElement | null {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') return null
  const sink = document.getElementById(TERMINAL_INPUT_FOCUS_SINK_ID)
  return sink instanceof HTMLElement ? sink : null
}
