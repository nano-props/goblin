import * as xtermHeadlessImport from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type {
  ITerminalAddon,
  ITerminalInitOnlyOptions,
  ITerminalOptions,
  Terminal as HeadlessTerminalInstance,
} from '@xterm/headless'
import {
  createEmptyTerminalControlSequenceScannerState,
  scanTerminalControlSequences,
  type TerminalControlSequenceEvent,
  type TerminalControlSequenceScannerState,
} from '#/server/terminal/terminal-control-sequence-scanner.ts'
import { serverLogger } from '#/server/logger.ts'

// Per-session render state. Recovery hydration is generated from the
// server-side headless xterm state, so "current screen" semantics stay in
// xterm's parser instead of replaying historical erase/repaint bytes into each
// newly-attached client.
//
// Realtime metadata intentionally uses a separate synchronous control-sequence
// scanner. Title/bell events must be known while handling the PTY chunk so the
// server can preserve title -> bell -> output ordering; @xterm/headless remains
// the async visual screen/snapshot authority.

const HEADLESS_SCROLLBACK_ROWS = 10_000
const terminalRenderStateLogger = serverLogger.child({ module: 'terminal-render-state' })

interface TerminalScreenState {
  terminal: HeadlessTerminalInstance
  serializer: SerializeAddon
  chain: Promise<void>
  disposePromise: Promise<void>
  resolveDisposed: () => void
  appliedSeq: number
  disposed: boolean
  failure: unknown | null
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
  /** Last OSC 0/2 title set by the shell. */
  title: string | null
  controlScanner: TerminalControlSequenceScannerState
  screen: TerminalScreenState
}

export function createEmptyTerminalRenderState(cols: number, rows: number): TerminalRenderState {
  return {
    sequence: 0,
    title: null,
    controlScanner: createEmptyTerminalControlSequenceScannerState(),
    screen: createScreenState(cols, rows),
  }
}

export interface AppendTerminalOutputResult {
  seq: number
  controlEvents: TerminalControlSequenceEvent[]
}

// Single synchronous ingress for PTY chunks. Realtime metadata is scanned here
// before the chunk is queued into @xterm/headless, but title state is applied
// by the runtime while replaying the ordered control events. That keeps title
// ownership aligned with event ordering, while headless remains the async
// visual screen authority used for snapshots.
export function appendOutput(state: TerminalRenderState, data: string): AppendTerminalOutputResult {
  state.sequence += 1
  const seq = state.sequence
  const control = scanTerminalControlSequences(data, state.controlScanner)
  queueScreenWrite(state.screen, data, seq)
  return {
    seq,
    controlEvents: control.events,
  }
}

export function applyTerminalTitle(state: TerminalRenderState, title: string | null): void {
  state.title = title
}

export interface RenderSnapshot {
  /** Serialized current screen to write into the client xterm. */
  snapshot: string
  /** Last sequence included in the serialized headless screen. Client dedup boundary. */
  snapshotSeq: number
}

export async function replaySnapshot(state: TerminalRenderState): Promise<RenderSnapshot | null> {
  const screen = state.screen
  const completion = Promise.withResolvers<RenderSnapshot | null>()
  // Serialization is itself a render-chain step. Output queued before this
  // call is included and advances `appliedSeq`; output queued afterwards is
  // ordered behind the snapshot and remains available through realtime.
  // This makes snapshot bytes and snapshotSeq one atomic read of the headless
  // xterm instead of observing the mutable screen after a detached fence.
  queueScreenStep(screen, (current) => {
    if (current.failure) {
      completion.resolve(null)
      return
    }
    try {
      completion.resolve({ snapshot: current.serializer.serialize(), snapshotSeq: current.appliedSeq })
    } catch (err) {
      terminalRenderStateLogger.warn({ err }, 'failed to serialize terminal recovery snapshot')
      completion.resolve(null)
    }
  })
  return await Promise.race([completion.promise, screen.disposePromise.then(() => null)])
}

export function resizeRender(state: TerminalRenderState, cols: number, rows: number): void {
  queueScreenStep(state.screen, (screen) => {
    screen.terminal.resize(cols, rows)
  })
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
  // The serializer declares the browser Terminal in activate(), while the
  // supported addon contract also works with the headless Terminal at runtime.
  terminal.loadAddon(serializer as unknown as ITerminalAddon)
  return {
    terminal,
    serializer,
    chain: Promise.resolve(),
    disposePromise,
    resolveDisposed,
    appliedSeq: 0,
    disposed: false,
    failure: null,
  }
}

function queueScreenWrite(screen: TerminalScreenState, data: string, seq: number): void {
  queueScreenStep(screen, (current) => {
    return Promise.race([
      new Promise<void>((resolve) => {
        current.terminal.write(data, () => {
          if (!current.disposed) current.appliedSeq = Math.max(current.appliedSeq, seq)
          resolve()
        })
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
    try {
      await step(screen)
    } catch (err) {
      screen.failure ??= err
      terminalRenderStateLogger.warn({ err }, 'headless terminal render step failed')
    }
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
