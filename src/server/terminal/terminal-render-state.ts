// Per-session render state. Owns the raw output stream the server replays
// to a newly-attached client, plus a sequence counter for client-side
// dedup. The buffer is the single source of truth — there is no headless
// xterm or serialization layer here, the client writes the replay into
// its own local xterm and that is what the user sees.

const MAX_BUFFER_CHARS = 16 * 1024 * 1024

export interface TerminalRenderState {
  cols: number
  rows: number
  sequence: number
  /** Concatenated raw PTY output. The client writes this verbatim into its xterm on attach. */
  buffer: string
  /** Set to true the first time the buffer is truncated. Stays true for the rest of the session. */
  bufferTruncated: boolean
  /** Last OSC 0 title set by the shell (parsed out of `buffer`). */
  title: string | null
}

export function createEmptyTerminalRenderState(cols: number, rows: number): TerminalRenderState {
  return { cols, rows, sequence: 0, buffer: '', bufferTruncated: false, title: null }
}

export function resizeRender(state: TerminalRenderState, cols: number, rows: number): void {
  state.cols = cols
  state.rows = rows
}

export function appendOutput(state: TerminalRenderState, data: string): number {
  state.sequence += 1
  state.buffer += data
  if (state.buffer.length > MAX_BUFFER_CHARS) {
    state.buffer = safeTail(state.buffer, MAX_BUFFER_CHARS)
    state.bufferTruncated = true
  }
  const newTitle = extractTitle(data)
  if (newTitle !== undefined && newTitle !== state.title) state.title = newTitle
  return state.sequence
}

export interface RenderSnapshot {
  /** Raw output to write into the client xterm. */
  snapshot: string
  /** Sequence at the time the snapshot was taken. Client dedup boundary. */
  snapshotSeq: number
  /** True iff the buffer was ever truncated; client should reset its xterm. */
  snapshotTruncated: boolean
}

export function takeSnapshot(state: TerminalRenderState): RenderSnapshot | null {
  if (state.sequence === 0) return null
  return {
    snapshot: state.buffer,
    snapshotSeq: state.sequence,
    snapshotTruncated: state.bufferTruncated,
  }
}

export function resetRender(state: TerminalRenderState, cols: number, rows: number): void {
  state.cols = cols
  state.rows = rows
  state.sequence = 0
  state.buffer = ''
  state.bufferTruncated = false
  state.title = null
}

// Pull a tail slice off `buffer` that is safe to use as a replay
// starting point. Strips split surrogate pairs and incomplete ANSI
// sequences at the boundary so the client can resume cleanly.
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
      if (c >= 0x30 && c <= 0x3f) { i++; continue }
      if (c >= 0x20 && c <= 0x2f) { i++; continue }
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

// OSC 0 is the "set window title" sequence the shell uses for the tab title.
// The shell may also use OSC 2 — we treat both the same way: keep the
// last title seen in this chunk. Returns `undefined` if no title sequence
// was present (caller can skip the assignment in that case); an empty
// captured string maps to `null` (clear the title).
function extractTitle(data: string): string | null | undefined {
  let title: string | null | undefined
  for (const m of data.matchAll(/\x1b\][02];([^\x07\x1b]*)\x07/g)) {
    const captured = m[1] ?? null
    title = captured === '' ? null : captured
  }
  return title
}
