const MAX_TITLE_CHARS = 4096
const ESC = '\x1b'
const BEL = '\x07'
const OSC_C1 = '\x9d'
const ST_C1 = '\x9c'
const CAN = '\x18'
const SUB = '\x1a'
const OSC_7BIT = ']'
const ST_7BIT = '\\'

export interface TerminalControlSequenceScannerState {
  mode: 'ground' | 'escape' | 'osc'
  command: string
  payload: string
  collectingTitle: boolean
  titleTooLong: boolean
}

export type TerminalControlSequenceEvent = { type: 'bell' } | { type: 'title'; title: string | null }

export interface TerminalControlSequenceScanResult {
  events: TerminalControlSequenceEvent[]
}

export function createEmptyTerminalControlSequenceScannerState(): TerminalControlSequenceScannerState {
  return {
    mode: 'ground',
    command: '',
    payload: '',
    collectingTitle: false,
    titleTooLong: false,
  }
}

// Streaming scanner for realtime terminal metadata. This intentionally stays
// separate from the async @xterm/headless screen pipeline: title/bell events
// have to be available synchronously for the PTY chunk so the server can emit
// metadata before the corresponding output event, while headless remains the
// visual screen/snapshot authority for attach and takeover hydration. The OSC
// string boundaries mirror xterm.js: BEL/ST finish successfully, CAN/SUB abort,
// and ESC finishes the string while the following byte is parsed as a fresh
// escape sequence (so ESC \\ is naturally swallowed as 7-bit ST).
export function scanTerminalControlSequences(
  data: string,
  state: TerminalControlSequenceScannerState,
): TerminalControlSequenceScanResult {
  const events: TerminalControlSequenceEvent[] = []
  for (let i = 0; i < data.length; i += 1) {
    const char = data[i]
    if (state.mode === 'escape') {
      state.mode = 'ground'
      if (char === OSC_7BIT) {
        startOsc(state)
        continue
      }
      if (char === ST_7BIT) continue
    }

    if (state.mode === 'osc') {
      if (char === BEL || char === ST_C1) {
        const finishedTitle = finishOsc(state, true)
        if (finishedTitle !== undefined) events.push({ type: 'title', title: finishedTitle })
        continue
      }
      if (char === CAN || char === SUB) {
        finishOsc(state, false)
        continue
      }
      if (char === ESC) {
        const finishedTitle = finishOsc(state, true)
        if (finishedTitle !== undefined) events.push({ type: 'title', title: finishedTitle })
        state.mode = 'escape'
        continue
      }
      appendOscChar(state, char)
      continue
    }

    if (char === BEL) {
      events.push({ type: 'bell' })
      continue
    }
    if (char === OSC_C1) {
      startOsc(state)
    } else if (char === ESC) {
      state.mode = 'escape'
    }
  }
  return { events }
}

function startOsc(state: TerminalControlSequenceScannerState): void {
  state.mode = 'osc'
  state.command = ''
  state.payload = ''
  state.collectingTitle = false
  state.titleTooLong = false
}

function finishOsc(state: TerminalControlSequenceScannerState, success: boolean): string | null | undefined {
  const shouldApply =
    success && !state.titleTooLong && (state.collectingTitle || state.command === '0' || state.command === '2')
  const payload = state.payload
  Object.assign(state, createEmptyTerminalControlSequenceScannerState())
  if (!shouldApply) return undefined
  return payload === '' ? null : payload
}

function appendOscChar(state: TerminalControlSequenceScannerState, char: string): void {
  if (!state.collectingTitle) {
    if (char === ';') {
      state.collectingTitle = state.command === '0' || state.command === '2'
      return
    }
    if (state.command.length < 8) state.command += char
    return
  }
  if (state.titleTooLong) return
  if (state.payload.length + char.length > MAX_TITLE_CHARS) {
    state.payload = ''
    state.titleTooLong = true
    return
  }
  state.payload += char
}
