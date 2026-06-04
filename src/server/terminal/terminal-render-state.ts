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
  Terminal: new (options?: { cols?: number; rows?: number; scrollback?: number; allowProposedApi?: boolean }) => HeadlessTerminalLike
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
  return state.model?.term.onTitleChange((title) => {
    state.titleEventVersion += 1
    const nextCanonicalTitle = normalizeTerminalTitle(title)
    if (state.canonicalTitle === nextCanonicalTitle) return
    state.canonicalTitle = nextCanonicalTitle
    onTitle(nextCanonicalTitle)
  }) ?? { dispose() {} }
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

export async function snapshotTerminalRenderState(
  sessionId: string,
  state: TerminalRenderState,
): Promise<TerminalSessionSnapshot | null> {
  if (!state.model) return null
  const snapshotSeq = state.sequence
  const chain = state.model.chain
  try {
    await chain
  } catch {}
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
  const first = tail.charCodeAt(0)
  const second = tail.length > 1 ? tail.charCodeAt(1) : 0
  if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1)
  else if (first >= 0xd800 && first <= 0xdbff && !(second >= 0xdc00 && second <= 0xdfff)) tail = tail.slice(1)
  const boundary = tail.search(/[\n\r]/)
  return boundary >= 0 && boundary < tail.length - 1 ? tail.slice(boundary + 1) : tail
}

function normalizeTerminalTitle(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function isShellProcessName(processName: string): boolean {
  return /^(?:ba|z|fi|tc|c|k)?sh$|^nu$/.test(processName)
}
