import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import {
  appendOutput,
  applyTerminalTitle,
  createEmptyTerminalRenderState,
  disposeRender,
  resetRender,
  resizeRender,
  takeSnapshot,
  type TerminalRenderState,
} from '#/server/terminal/terminal-render-state.ts'

describe('terminal-render-state', () => {
  const states: TerminalRenderState[] = []

  afterEach(() => {
    for (const state of states.splice(0)) disposeRender(state)
  })

  function createState(): TerminalRenderState {
    const state = createEmptyTerminalRenderState()
    states.push(state)
    return state
  }

  function createRawOnlyState(): TerminalRenderState {
    const state = createState()
    disposeRender(state)
    return state
  }

  function appendOutputAndApplyTitleEvents(state: TerminalRenderState, data: string): ReturnType<typeof appendOutput> {
    const output = appendOutput(state, data)
    for (const event of output.controlEvents) {
      if (event.type === 'title') applyTerminalTitle(state, event.title)
    }
    return output
  }

  describe('appendOutput', () => {
    test('increments sequence and appends data without truncation when under limit', () => {
      const state = createRawOnlyState()
      const first = appendOutput(state, 'hello')
      expect(first.seq).toBe(1)
      expect(first).toMatchObject({ controlEvents: [] })
      expect(state.sequence).toBe(1)
      expect(state.buffer).toBe('hello')
      expect(state.bufferTruncated).toBe(false)

      const second = appendOutput(state, ' world')
      expect(second.seq).toBe(2)
      expect(state.sequence).toBe(2)
      expect(state.buffer).toBe('hello world')
    })

    test('truncates the buffer to the last 16 MB and sets the truncated flag', () => {
      const state = createRawOnlyState()
      const big = 'a'.repeat(20 * 1024 * 1024) // 20 MB
      appendOutput(state, big)
      expect(state.buffer.length).toBeLessThanOrEqual(16 * 1024 * 1024 + 10) // allow a small margin for the reset prefix
      expect(state.bufferTruncated).toBe(true)
    })

    test('keeps the tail end of a long buffer (recent data is preserved)', () => {
      const state = createRawOnlyState()
      const prefix = 'x'.repeat(5 * 1024 * 1024)
      const suffix = 'tail-marker-12345'
      appendOutput(state, prefix + suffix)
      expect(state.buffer).toContain(suffix)
    })

    test('prefixes the truncated tail with a reset so the replay is safe to apply', () => {
      const state = createRawOnlyState()
      const big = 'a'.repeat(20 * 1024 * 1024)
      appendOutput(state, big)
      // After truncation, the head is an ANSI reset so any truncated SGR
      // sequences from the cut point don't bleed into the replayed state.
      expect(state.buffer.startsWith('\x1b[0m')).toBe(true)
    })

    test('does not break surrogate pairs at the truncation boundary', () => {
      const state = createRawOnlyState()
      // Build a string where a surrogate pair sits exactly at the 16 MB boundary
      const pad = 'a'.repeat(16 * 1024 * 1024 - 1)
      const pair = '\uD83D\uDE00' // 😀
      appendOutput(state, pad + pair + 'tail')
      expect(state.buffer).toContain('tail')
      // The high or low surrogate must not be left dangling at the start of the tail
      const tailStart = state.buffer.indexOf('\x1b[0m') + 4
      const firstCode = state.buffer.charCodeAt(tailStart)
      const isLoneLow = firstCode >= 0xdc00 && firstCode <= 0xdfff
      expect(isLoneLow).toBe(false)
    })

    test('strips an incomplete CSI sequence at the truncation boundary', () => {
      const state = createRawOnlyState()
      // \x1b[31m sets red; truncate so tail starts inside the sequence
      const pad = 'a'.repeat(16 * 1024 * 1024 - 3)
      appendOutput(state, pad + '\x1b[31mred-text')
      const afterReset = state.buffer.slice(4) // after \x1b[0m
      expect(afterReset.startsWith('\x1b[')).toBe(false)
      expect(state.buffer).toContain('red-text')
    })

    test('preserves a complete CSI sequence at the truncation boundary', () => {
      const state = createRawOnlyState()
      const pad = 'a'.repeat(16 * 1024 * 1024 - 10)
      appendOutput(state, pad + '\x1b[38;2;255;0;0mcolor')
      expect(state.buffer).toContain('color')
    })

    test('prefers a line boundary for a clean visual cut', () => {
      const state = createRawOnlyState()
      const line1 = 'first-line\n'
      const line2 = 'second-line\n'
      const line3 = 'third-line-tail'
      const pad = 'x'.repeat(16 * 1024 * 1024 - line1.length - line2.length - line3.length + 1)
      appendOutput(state, pad + line1 + line2 + line3)
      const afterReset = state.buffer.slice(4) // after \x1b[0m
      expect(afterReset.startsWith('second-line')).toBe(true)
    })

    test('handles a lone trailing ESC at the truncation boundary', () => {
      const state = createRawOnlyState()
      // Fill the buffer with content ending in a bare ESC. The
      // truncation boundary must not leave `\x1b` as the very first
      // character of the tail, since that would be a malformed escape
      // for the client to parse.
      const pad = 'a'.repeat(16 * 1024 * 1024)
      appendOutput(state, pad + '\x1b')
      const afterReset = state.buffer.slice(4)
      expect(afterReset.charCodeAt(0)).not.toBe(0x1b)
    })

    test('returns title control events without applying title state', () => {
      const state = createRawOnlyState()
      const output = appendOutput(state, '\x1b]0;deferred\x07')
      expect(output.controlEvents).toEqual([{ type: 'title', title: 'deferred' }])
      expect(state.title).toBeNull()
      applyTerminalTitle(state, 'deferred')
      expect(state.title).toBe('deferred')
    })
  })

  describe('title extraction', () => {
    test('captures the last OSC 0 title from a chunk', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b]0;first title\x07more data')
      expect(state.title).toBe('first title')
      appendOutputAndApplyTitleEvents(state, '\x1b]0;second title\x07')
      expect(state.title).toBe('second title')
    })

    test('treats OSC 2 the same as OSC 0', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b]2;icon title\x07')
      expect(state.title).toBe('icon title')
    })

    test('clears the title when the shell emits an empty OSC string', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b]0;a title\x07')
      expect(state.title).toBe('a title')
      appendOutputAndApplyTitleEvents(state, '\x1b]0;\x07')
      expect(state.title).toBeNull()
    })

    test('leaves the title null when no OSC 0 sequence is present', () => {
      const state = createRawOnlyState()
      appendOutput(state, 'plain text output')
      expect(state.title).toBeNull()
    })

    test('reassembles an OSC 0 sequence split across two appendOutput calls', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b]0;~/Developer/goblin — ')
      expect(state.title).toBeNull()
      appendOutputAndApplyTitleEvents(state, 'npm run dev\x07')
      expect(state.title).toBe('~/Developer/goblin — npm run dev')
    })

    test('reassembles a split ESC before an OSC 0 sequence', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b')
      expect(state.title).toBeNull()
      appendOutputAndApplyTitleEvents(state, ']0;split-start\x07')
      expect(state.title).toBe('split-start')
    })

    test('captures an ST-terminated OSC 0 sequence', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b]0;st title\x1b\\')
      expect(state.title).toBe('st title')
    })

    test('captures a C1 OSC title sequence', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x9d2;devin running\x9c')
      expect(state.title).toBe('devin running')
    })

    test('captures a C1 OSC title sequence terminated by BEL', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x9d0;devin session\x07')
      expect(state.title).toBe('devin session')
    })

    test('reassembles a C1 OSC title sequence split across appendOutput calls', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x9d2;devin ')
      expect(state.title).toBeNull()
      appendOutputAndApplyTitleEvents(state, 'running\x9c')
      expect(state.title).toBe('devin running')
    })

    test('ends an OSC title at ESC and swallows the second byte of a split 7-bit ST', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b]0;split-st\x1b')
      expect(state.title).toBe('split-st')
      appendOutput(state, '\\')
      expect(state.title).toBe('split-st')
    })

    test('does not apply an OSC title aborted by CAN or SUB', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b]0;stable\x07')
      appendOutputAndApplyTitleEvents(state, '\x1b]0;aborted\x18')
      expect(state.title).toBe('stable')
      appendOutputAndApplyTitleEvents(state, '\x1b]2;also aborted\x1a')
      expect(state.title).toBe('stable')
    })

    test('clears the title when OSC 0 or OSC 2 ends without a payload separator', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b]0;stable\x07')
      appendOutputAndApplyTitleEvents(state, '\x1b]0\x07')
      expect(state.title).toBeNull()
      appendOutputAndApplyTitleEvents(state, '\x1b]2;stable\x07')
      appendOutputAndApplyTitleEvents(state, '\x1b]2\x07')
      expect(state.title).toBeNull()
    })

    test('captures Devin CLI macOS title sequences and ignores OSC 30', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b[22;0t\x1b]0;devin: goblin\x07\x1b]30;devin: goblin\x07')
      expect(state.title).toBe('devin: goblin')
      appendOutputAndApplyTitleEvents(state, '\x1b]30;devin: ignored\x07')
      expect(state.title).toBe('devin: goblin')
      appendOutputAndApplyTitleEvents(state, '\x1b]0;devin: hello\x07\x1b]30;devin: hello\x07')
      expect(state.title).toBe('devin: hello')
    })

    test('ignores unsupported OSC commands without losing a later title', () => {
      const state = createRawOnlyState()
      appendOutputAndApplyTitleEvents(state, '\x1b]9;ignored\x07\x1b]2;window title\x07')
      expect(state.title).toBe('window title')
    })
  })

  describe('takeSnapshot', () => {
    test('loads and serializes under Node ESM runtime interop', () => {
      const moduleUrl = pathToFileURL(`${process.cwd()}/src/server/terminal/terminal-render-state.ts`).href
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
            import {
              appendOutput,
              createEmptyTerminalRenderState,
              disposeRender,
              takeSnapshot,
            } from ${JSON.stringify(moduleUrl)}
            const state = createEmptyTerminalRenderState()
            appendOutput(state, 'ok')
            const snap = await takeSnapshot(state)
            disposeRender(state)
            if (!snap || snap.snapshot !== 'ok' || snap.snapshotSeq !== 1) {
              throw new Error(JSON.stringify(snap))
            }
          `,
        ],
        { cwd: process.cwd(), encoding: 'utf8' },
      )
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
    })

    test('returns null when nothing has been appended', async () => {
      const state = createState()
      await expect(takeSnapshot(state)).resolves.toBeNull()
    })

    test('returns null instead of hanging after render disposal', async () => {
      const state = createState()
      appendOutput(state, 'history')
      disposeRender(state)

      await expect(withSnapshotTimeout(takeSnapshot(state))).resolves.toBeNull()
    })

    test('continues on the replacement screen when reset disposes an in-flight write', async () => {
      const state = createState()
      const oldScreen = (state as unknown as { screen: { terminal: { write: () => void } } }).screen
      oldScreen.terminal.write = () => undefined

      appendOutput(state, 'stuck')
      const snapshotPromise = takeSnapshot(state)
      resetRender(state)
      appendOutput(state, 'fresh')

      await expect(withSnapshotTimeout(snapshotPromise)).resolves.toEqual({
        snapshot: 'fresh',
        snapshotSeq: 1,
        snapshotTruncated: false,
      })
    })

    test('serializes the current headless screen and applied sequence as the snapshot', async () => {
      const state = createState()
      appendOutput(state, 'a')
      appendOutput(state, 'b')
      const snap = await takeSnapshot(state)
      expect(snap).toEqual({ snapshot: 'ab', snapshotSeq: 2, snapshotTruncated: false })
    })

    test('serializes zsh prompt end-marker repaint as the final screen, not raw replay bytes', async () => {
      const state = createState()
      appendOutput(
        state,
        '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                            \r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J👾:~/repo\r\n$ ',
      )

      const snap = await takeSnapshot(state)

      expect(snap?.snapshot).toContain('👾:~/repo')
      expect(snap?.snapshot).toContain('$ ')
      expect(snap?.snapshot).not.toContain('\x1b[7m%')
      expect(snap).toMatchObject({ snapshotSeq: 1, snapshotTruncated: false })
    })

    test('keeps raw bytes for diagnostics while snapshots use headless screen semantics', async () => {
      const state = createState()
      const marker =
        '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                            \r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J'
      appendOutput(state, `command output${marker}next prompt`)

      const snap = await takeSnapshot(state)

      expect(state.buffer).toBe(`command output${marker}next prompt`)
      expect(snap?.snapshot).toContain('next prompt')
      expect(snap?.snapshot).not.toContain(marker)
    })

    test('includes the truncated flag once the raw buffer has been truncated', async () => {
      const state = createState()
      state.bufferTruncated = true
      appendOutput(state, 'a')
      const snap = await takeSnapshot(state)
      expect(snap).toBeTruthy()
      expect(snap!.snapshotTruncated).toBe(true)
    })

    test('queues resize into the same headless screen chain without changing the snapshot sequence', async () => {
      const state = createState()
      appendOutput(state, 'prompt')
      resizeRender(state, 100, 30)

      const snap = await takeSnapshot(state)

      expect(snap).toEqual({ snapshot: 'prompt', snapshotSeq: 1, snapshotTruncated: false })
    })
  })

  describe('resetRender', () => {
    test('clears the buffer, sequence, and title back to the initial state', () => {
      const state = createRawOnlyState()
      appendOutput(state, 'history')
      appendOutputAndApplyTitleEvents(state, '\x1b]0;a title\x07')
      resetRender(state)
      expect(state.sequence).toBe(0)
      expect(state.buffer).toBe('')
      expect(state.bufferTruncated).toBe(false)
      expect(state.title).toBeNull()
    })
  })
})

async function withSnapshotTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('snapshot timed out')), 250)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
