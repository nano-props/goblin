import * as xtermHeadlessImport from '@xterm/headless'
import type { SerializeAddon as XTermSerializeAddon } from '@xterm/addon-serialize'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { TerminalSessionSnapshot } from '#/shared/terminal.ts'

const MAX_SESSION_BUFFER_CHARS = 16 * 1024 * 1024

export interface HeadlessTerminalLike {
  write(data: string | Uint8Array, callback?: () => void): void
  resize(cols: number, rows: number): void
  loadAddon(addon: XTermSerializeAddon): void
  onTitleChange(listener: (title: string) => void): { dispose(): void }
  dispose(): void
}

export interface TerminalRenderModel {
  term: HeadlessTerminalLike
  serializeAddon: XTermSerializeAddon
  chain: Promise<void>
}

export interface TerminalRenderState {
  buffer: string
  bufferTruncated: boolean
  sequence: number
  canonicalTitle: string | null
  titleEventVersion: number
  model: TerminalRenderModel | null
}

const headlessModule = ('default' in xtermHeadlessImport ? xtermHeadlessImport.default : xtermHeadlessImport) as {
  Terminal: new (options?: {
    cols?: number
    rows?: number
    scrollback?: number
    allowProposedApi?: boolean
  }) => HeadlessTerminalLike
}
const { Terminal: HeadlessTerminal } = headlessModule

export function createEmptyTerminalRenderState(): TerminalRenderState {
  return {
    buffer: '',
    bufferTruncated: false,
    sequence: 0,
    canonicalTitle: null,
    titleEventVersion: 0,
    model: null,
  }
}

export function createTerminalRenderModel(cols: number, rows: number): TerminalRenderModel {
  const term = new HeadlessTerminal({ cols, rows, scrollback: 10000, allowProposedApi: true })
  const serializeAddon = new SerializeAddon()
  term.loadAddon(serializeAddon)
  return {
    term,
    serializeAddon,
    chain: Promise.resolve(),
  }
}

export function bindTerminalRenderTitle(
  state: TerminalRenderState,
  onTitle: (canonicalTitle: string | null) => void,
): { dispose(): void } {
  return (
    state.model?.term.onTitleChange((title) => {
      state.titleEventVersion += 1
      const nextCanonicalTitle = normalizeTerminalTitle(title)
      if (state.canonicalTitle === nextCanonicalTitle) return
      state.canonicalTitle = nextCanonicalTitle
      onTitle(nextCanonicalTitle)
    }) ?? { dispose() {} }
  )
}

export function appendTerminalReplayData(state: TerminalRenderState, data: string): number {
  state.sequence += 1
  state.buffer += data
  if (state.buffer.length > MAX_SESSION_BUFFER_CHARS) {
    state.buffer = safeReplayTail(state.buffer, MAX_SESSION_BUFFER_CHARS)
    state.bufferTruncated = true
  }
  return state.sequence
}

export function queueTerminalRenderWrite(state: TerminalRenderState, data: string, onParsed?: () => void): void {
  const model = state.model
  if (!model) return
  model.chain = model.chain
    .catch(() => {})
    .then(
      () =>
        new Promise<void>((resolve) => {
          model.term.write(data, resolve)
        }),
    )
    .then(() => {
      if (state.model !== model) return
      onParsed?.()
    })
}

export function queueTerminalRenderResize(state: TerminalRenderState, cols: number, rows: number): void {
  const model = state.model
  if (!model) return
  model.chain = model.chain
    .catch(() => {})
    .then(() => {
      model.term.resize(cols, rows)
    })
}

/**
 * Erase the headless's visible area, then resize to the new dimensions, in a
 * single chain step.
 *
 * Why combine: the headless lives at whatever size it was last resized to.
 * When the PTY is resized, the shell receives SIGWINCH and re-paints the
 * prompt at the new dimensions; the re-paint reaches the headless via
 * PTY.onData. If the headless is still at the old size when the re-paint
 * arrives, the re-paint is processed (and possibly wrapped/truncated) at
 * the old size, and a subsequent deferred headless resize reflows the
 * buffer — letting the original prompt cells survive into the snapshot
 * alongside the re-painted prompt. The client then sees a duplicated line.
 *
 * Erasing the visible area with `\e[2J` first (xterm's default
 * `scrollOnEraseInDisplay: false` keeps scrollback intact) removes the
 * cells that would otherwise be reflowed into the new visible area, and
 * putting the erase and the resize in the same chain step guarantees the
 * shell's re-paint lands on a clean, correctly-sized headless.
 *
 * The write callback is used so the chain step does not resolve until xterm
 * has actually applied the `\e[2J` to the headless. Without the callback,
 * the step would resolve as soon as JavaScript returns from `term.write`,
 * but the xterm.js WriteBuffer would still have the write pending — leaving
 * any subsequent snapshot that awaits this chain reading the pre-wipe
 * buffer.
 */
export function queueTerminalRenderClearAndResize(
  state: TerminalRenderState,
  cols: number,
  rows: number,
): void {
  const model = state.model
  if (!model) return
  model.chain = model.chain
    .catch(() => {})
    .then(
      () =>
        new Promise<void>((resolve) => {
          model.term.write('\x1b[2J', () => {
            model.term.resize(cols, rows)
            resolve()
          })
        }),
    )
}

export async function snapshotTerminalRenderState(
  sessionId: string,
  state: TerminalRenderState,
): Promise<TerminalSessionSnapshot | null> {
  if (!state.model) return null
  const chain = state.model.chain
  try {
    await chain
  } catch {}
  if (!state.model) return null
  // Read the seq *after* the chain has drained. Any data whose write was
  // queued by appendTerminalReplayData during the await is included in the
  // serialized snapshot below, so the seq we return must reflect that
  // inclusion — otherwise the client's dedup boundary would be set too low
  // and the live `output` event for the same data would be re-applied to
  // the xterm, producing a visible duplicate of the prompt (or any other
  // re-paint) on re-attach.
  const snapshotSeq = state.sequence
  return {
    sessionId,
    snapshot: state.model.serializeAddon.serialize({ excludeAltBuffer: false }),
    snapshotSeq,
  }
}

export function resetTerminalRenderState(state: TerminalRenderState): void {
  state.buffer = ''
  state.bufferTruncated = false
  state.sequence = 0
  state.canonicalTitle = null
  state.titleEventVersion = 0
}

export function disposeTerminalRenderState(state: TerminalRenderState): void {
  try {
    state.model?.term.dispose()
  } catch {}
  state.model = null
}

export function maybeClearCanonicalTitleOnShellReturn(
  sessionId: string,
  state: TerminalRenderState,
  previousProcessName: string,
  nextProcessName: string,
  currentProcessName: string,
  canonicalTitleBeforeWrite: string | null,
  titleEventVersionBeforeWrite: number,
  onTitle: (canonicalTitle: string | null) => void,
): void {
  if (!canonicalTitleBeforeWrite) return
  if (previousProcessName === nextProcessName) return
  if (!isShellProcessName(nextProcessName) || isShellProcessName(previousProcessName)) return
  if (currentProcessName !== nextProcessName) return
  if (state.titleEventVersion !== titleEventVersionBeforeWrite) return
  if (state.canonicalTitle !== canonicalTitleBeforeWrite) return
  state.canonicalTitle = null
  onTitle(null)
}

function safeReplayTail(buffer: string, maxChars: number): string {
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

function normalizeTerminalTitle(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function isShellProcessName(processName: string): boolean {
  const base = processName.replace(/^.*[\\/]/, '')
  return /^(?:ba|z|fi|tc|c|k)?sh$|^nu$/.test(base)
}
