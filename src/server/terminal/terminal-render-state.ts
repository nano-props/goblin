import * as xtermHeadlessImport from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type {
  ITerminalAddon,
  ITerminalInitOnlyOptions,
  ITerminalOptions,
  Terminal as HeadlessTerminalInstance,
} from '@xterm/headless'

// Per-session render state. The raw PTY buffer is retained for diagnostics
// and bounded-tail recovery, but attach/takeover hydration is generated from
// the server-side headless xterm state. That keeps "current screen" semantics
// in xterm's parser instead of replaying historical erase/repaint bytes into
// each newly-attached client.

const MAX_BUFFER_CHARS = 16 * 1024 * 1024
const MAX_TITLE_CHARS = 4096
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const HEADLESS_SCROLLBACK_ROWS = 10_000

interface TerminalScreenState {
  terminal: HeadlessTerminalInstance
  serializer: SerializeAddon
  chain: Promise<void>
  disposePromise: Promise<void>
  resolveDisposed: () => void
  appliedSeq: number
  disposed: boolean
}

type HeadlessTerminalConstructor = new (
  options?: ITerminalOptions & ITerminalInitOnlyOptions,
) => HeadlessTerminalInstance

const headlessModule = ('default' in xtermHeadlessImport ? xtermHeadlessImport.default : xtermHeadlessImport) as {
  Terminal: HeadlessTerminalConstructor
}
const HeadlessTerminal = headlessModule.Terminal

export interface TerminalRenderState {
  sequence: number
  /** Concatenated raw PTY output retained for diagnostics and bounded fallback state. */
  buffer: string
  /** Set to true the first time the buffer is truncated. Stays true for the rest of the session. */
  bufferTruncated: boolean
  /** Last OSC 0/2 title set by the shell. */
  title: string | null
  titleParser: TerminalTitleParserState
  screen: TerminalScreenState
}

export function createEmptyTerminalRenderState(
  cols: number = DEFAULT_COLS,
  rows: number = DEFAULT_ROWS,
): TerminalRenderState {
  return {
    sequence: 0,
    buffer: '',
    bufferTruncated: false,
    title: null,
    titleParser: createEmptyTerminalTitleParserState(),
    screen: createScreenState(cols, rows),
  }
}

export function appendOutput(state: TerminalRenderState, data: string): number {
  state.sequence += 1
  const seq = state.sequence
  state.buffer += data
  if (state.buffer.length > MAX_BUFFER_CHARS) {
    state.buffer = safeTail(state.buffer, MAX_BUFFER_CHARS)
    state.bufferTruncated = true
  }
  const newTitle = scanTerminalOutputForTitle(data, state.titleParser)
  if (newTitle !== undefined && newTitle !== state.title) state.title = newTitle
  queueScreenWrite(state.screen, data, seq)
  return seq
}

interface TerminalTitleParserState {
  inOsc: boolean
  pendingEsc: boolean
  command: string
  payload: string
  collectingTitle: boolean
  titleTooLong: boolean
}

function createEmptyTerminalTitleParserState(): TerminalTitleParserState {
  return {
    inOsc: false,
    pendingEsc: false,
    command: '',
    payload: '',
    collectingTitle: false,
    titleTooLong: false,
  }
}

export interface TerminalOutputBellScanState {
  inOsc: boolean
  pendingEsc: boolean
}

export function scanTerminalOutputForBell(
  data: string,
  initialState: TerminalOutputBellScanState,
): { hasBell: boolean; state: TerminalOutputBellScanState } {
  let inOsc = initialState.inOsc
  let pendingEsc = initialState.pendingEsc
  let hasBell = false
  for (let i = 0; i < data.length; i += 1) {
    const char = data[i]
    if (pendingEsc) {
      pendingEsc = false
      if (inOsc && char === '\\') {
        inOsc = false
        continue
      }
      if (!inOsc && char === ']') {
        inOsc = true
        continue
      }
    }
    if (inOsc) {
      if (char === '\x07') inOsc = false
      else if (char === '\x1b' && data[i + 1] === '\\') {
        inOsc = false
        i += 1
      } else if (char === '\x1b' && i === data.length - 1) {
        pendingEsc = true
      }
      continue
    }
    if (char === '\x07') {
      hasBell = true
      continue
    }
    if (char === '\x1b' && data[i + 1] === ']') {
      inOsc = true
      i += 1
    } else if (char === '\x1b' && i === data.length - 1) {
      pendingEsc = true
    }
  }
  return { hasBell, state: { inOsc, pendingEsc } }
}

export interface RenderSnapshot {
  /** Serialized current screen to write into the client xterm. */
  snapshot: string
  /** Last sequence included in the serialized headless screen. Client dedup boundary. */
  snapshotSeq: number
  /** True iff the buffer was ever truncated; client should reset its xterm. */
  snapshotTruncated: boolean
}

export async function replaySnapshot(state: TerminalRenderState): Promise<RenderSnapshot | null> {
  for (;;) {
    const screen = state.screen
    // Capture a fence instead of waiting for `state.screen.chain` to go
    // idle forever. Output appended after this point is intentionally left
    // for the client's seq-based live replay, while `appliedSeq` records
    // exactly how far the serialized headless screen has parsed.
    const fence = Promise.race([screen.chain.catch(() => undefined), screen.disposePromise])
    await fence
    if (screen !== state.screen) continue
    if (screen.disposed) return null
    return {
      snapshot: screen.serializer.serialize(),
      snapshotSeq: screen.appliedSeq,
      snapshotTruncated: state.bufferTruncated,
    }
  }
}

export async function takeSnapshot(state: TerminalRenderState): Promise<RenderSnapshot | null> {
  if (state.sequence === 0) return null
  return await replaySnapshot(state)
}

export function resizeRender(state: TerminalRenderState, cols: number, rows: number): void {
  queueScreenStep(state.screen, (screen) => {
    screen.terminal.resize(cols, rows)
  })
}

export function resetRender(
  state: TerminalRenderState,
  cols: number = DEFAULT_COLS,
  rows: number = DEFAULT_ROWS,
): void {
  disposeScreenState(state.screen)
  state.sequence = 0
  state.buffer = ''
  state.bufferTruncated = false
  state.title = null
  state.titleParser = createEmptyTerminalTitleParserState()
  state.screen = createScreenState(cols, rows)
}

export function disposeRender(state: TerminalRenderState): void {
  disposeScreenState(state.screen)
}

function createScreenState(cols: number, rows: number): TerminalScreenState {
  let resolveDisposed: () => void = () => undefined
  const disposePromise = new Promise<void>((resolve) => {
    resolveDisposed = resolve
  })
  const terminal = new HeadlessTerminal({
    allowProposedApi: true,
    cols,
    rows,
    scrollback: HEADLESS_SCROLLBACK_ROWS,
    rescaleOverlappingGlyphs: true,
  })
  terminal.loadAddon(new Unicode11Addon() as ITerminalAddon)
  terminal.unicode.activeVersion = '11'
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer as unknown as ITerminalAddon)
  return {
    terminal,
    serializer,
    chain: Promise.resolve(),
    disposePromise,
    resolveDisposed,
    appliedSeq: 0,
    disposed: false,
  }
}

function queueScreenWrite(screen: TerminalScreenState, data: string, seq: number): void {
  queueScreenStep(screen, (current) => {
    return Promise.race([
      new Promise<void>((resolve) => {
        try {
          current.terminal.write(data, () => {
            if (!current.disposed) current.appliedSeq = Math.max(current.appliedSeq, seq)
            resolve()
          })
        } catch {
          resolve()
        }
      }),
      current.disposePromise,
    ])
  })
}

function queueScreenStep(
  screen: TerminalScreenState,
  step: (screen: TerminalScreenState) => void | Promise<void>,
): void {
  const previous = screen.chain.catch(() => undefined)
  screen.chain = Promise.race([previous, screen.disposePromise]).then(async () => {
    if (screen.disposed) return
    await step(screen)
  })
}

function disposeScreenState(screen: TerminalScreenState): void {
  if (screen.disposed) return
  screen.disposed = true
  screen.resolveDisposed()
  try {
    screen.serializer.dispose()
  } catch {
    // Best effort: terminal disposal should still run even if an addon throws.
  }
  try {
    screen.terminal.dispose()
  } catch {
    // Best effort cleanup during session shutdown/restart.
  }
}

// Pull a tail slice off `buffer` that is safe to use as a replay
// starting point. Strips split surrogate pairs and incomplete ANSI
// sequences at the boundary so the client can resume cleanly.
//
// Theoretical edge case: if the 16 MB tail consists of a single
// incomplete escape sequence with no newline and no terminator byte
// in the [0x40, 0x7E] range (e.g. a misbehaving program emitting 16 MB
// of `\x1b[` with no parameters and no final byte), the strip step
// would discard the leading incomplete sequence and the line-boundary
// search would find nothing, so the returned tail would be just the
// `\x1b[0m` reset prefix. In practice this is not reachable because
// real programs mix text with escape sequences; we accept the corner
// case rather than add the complexity of a streaming parser.
function safeTail(buffer: string, maxChars: number): string {
  let tail = buffer.slice(buffer.length - maxChars)
  if (tail.length === 0) return tail

  // Fix split surrogate pair at truncation boundary
  const first = tail.charCodeAt(0)
  const second = tail.length > 1 ? tail.charCodeAt(1) : 0
  if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1)
  else if (first >= 0xd800 && first <= 0xdbff && !(second >= 0xdc00 && second <= 0xdfff)) tail = tail.slice(1)

  // Strip incomplete ANSI escape sequence at start of tail
  tail = stripLeadingIncompleteAnsi(tail)

  // Prefer line boundary for a clean visual cut
  const boundary = tail.search(/[\n\r]/)
  if (boundary >= 0 && boundary < tail.length - 1) tail = tail.slice(boundary + 1)

  // Prefix reset to guarantee a clean terminal state regardless of truncated SGR sequences
  return '\x1b[0m' + tail
}

function stripLeadingIncompleteAnsi(s: string): string {
  if (s.length === 0 || s.charCodeAt(0) !== 0x1b) return s
  // CSI sequence: ESC [ params(0x30-0x3F)* intermediate(0x20-0x2F)* final(0x40-0x7E)
  if (s.charCodeAt(1) === 0x5b) {
    let i = 2
    while (i < s.length) {
      const c = s.charCodeAt(i)
      if (c >= 0x30 && c <= 0x3f) {
        i++
        continue
      }
      if (c >= 0x20 && c <= 0x2f) {
        i++
        continue
      }
      if (c >= 0x40 && c <= 0x7e) return s // complete CSI
      break // incomplete
    }
    return s.slice(i) // discard the incomplete sequence
  }
  // Two-character independent control sequences (ESC Fe)
  const c2 = s.charCodeAt(1)
  if (c2 >= 0x40 && c2 <= 0x5a) return s
  if (c2 >= 0x5c && c2 <= 0x7e) return s
  // Unrecognized or incomplete ESC sequence: drop the leading ESC pair
  return s.slice(2)
}

// OSC 0 and OSC 2 are the title-setting sequences shells use for terminal
// tabs. This parser is stateful because PTY writes may split ESC ], payload,
// BEL, or ST across chunks. Unsupported OSC commands are skipped without
// retaining their payloads.
function scanTerminalOutputForTitle(
  data: string,
  state: TerminalTitleParserState,
): string | null | undefined {
  let title: string | null | undefined
  for (let i = 0; i < data.length; i += 1) {
    const char = data[i]
    if (state.pendingEsc) {
      state.pendingEsc = false
      if (state.inOsc && char === '\\') {
        title = finishTitleOsc(state)
        continue
      }
      if (!state.inOsc && char === ']') {
        startTitleOsc(state)
        continue
      }
      if (state.inOsc) appendTitleOscChar(state, '\x1b')
    }

    if (state.inOsc) {
      if (char === '\x07') {
        title = finishTitleOsc(state)
        continue
      }
      if (char === '\x1b') {
        if (i === data.length - 1) {
          state.pendingEsc = true
        } else if (data[i + 1] === '\\') {
          title = finishTitleOsc(state)
          i += 1
        } else {
          appendTitleOscChar(state, char)
        }
        continue
      }
      appendTitleOscChar(state, char)
      continue
    }

    if (char === '\x1b') {
      if (i === data.length - 1) {
        state.pendingEsc = true
      } else if (data[i + 1] === ']') {
        startTitleOsc(state)
        i += 1
      }
    }
  }
  return title
}

function startTitleOsc(state: TerminalTitleParserState): void {
  state.inOsc = true
  state.pendingEsc = false
  state.command = ''
  state.payload = ''
  state.collectingTitle = false
  state.titleTooLong = false
}

function finishTitleOsc(state: TerminalTitleParserState): string | null | undefined {
  const shouldApply = state.collectingTitle && !state.titleTooLong
  const payload = state.payload
  Object.assign(state, createEmptyTerminalTitleParserState())
  if (!shouldApply) return undefined
  return payload === '' ? null : payload
}

function appendTitleOscChar(state: TerminalTitleParserState, char: string): void {
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
