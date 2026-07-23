import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  appendOutput,
  applyTerminalTitle,
  createEmptyTerminalRenderState,
  disposeRender,
  replaySnapshot,
  resizeRender,
  type TerminalRenderState,
} from '#/server/terminal/terminal-render-state.ts'

describe('terminal-render-state', () => {
  const states: TerminalRenderState[] = []

  afterEach(() => {
    for (const state of states.splice(0)) disposeRender(state)
  })

  function createState(): TerminalRenderState {
    const state = createEmptyTerminalRenderState(80, 24)
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
    test('increments the output sequence for each chunk', () => {
      const state = createRawOnlyState()
      const first = appendOutput(state, 'hello')
      expect(first.seq).toBe(1)
      expect(first).toMatchObject({ controlEvents: [] })
      expect(state.sequence).toBe(1)

      const second = appendOutput(state, ' world')
      expect(second.seq).toBe(2)
      expect(state.sequence).toBe(2)
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

  test('normalizes serializer failure to an unavailable snapshot', async () => {
    const state = createState()
    state.screen.serializer.serialize = () => {
      throw new Error('serializer unavailable')
    }

    await expect(replaySnapshot(state)).resolves.toBeNull()
  })

  test('marks recovery unavailable when headless output application fails', async () => {
    const state = createState()
    vi.spyOn(state.screen.terminal, 'write').mockImplementation(() => {
      throw new Error('headless write failed')
    })

    appendOutput(state, 'unapplied output')

    await expect(replaySnapshot(state)).resolves.toBeNull()
  })

  test('marks recovery unavailable when headless resize application fails', async () => {
    const state = createState()
    vi.spyOn(state.screen.terminal, 'resize').mockImplementation(() => {
      throw new Error('headless resize failed')
    })

    resizeRender(state, 100, 30)

    await expect(replaySnapshot(state)).resolves.toBeNull()
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

  describe('replaySnapshot', () => {
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
              replaySnapshot,
            } from ${JSON.stringify(moduleUrl)}
            const state = createEmptyTerminalRenderState(80, 24)
            appendOutput(state, 'ok')
            const snap = await replaySnapshot(state)
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

    test('returns null instead of hanging after render disposal', async () => {
      const state = createState()
      appendOutput(state, 'history')
      disposeRender(state)

      await expect(withSnapshotTimeout(replaySnapshot(state))).resolves.toBeNull()
    })

    test('serializes the current headless screen and applied sequence as the snapshot', async () => {
      const state = createState()
      appendOutput(state, 'a')
      appendOutput(state, 'b')
      const snap = await replaySnapshot(state)
      expect(snap).toEqual({ snapshot: 'ab', snapshotSeq: 2 })
    })

    test('serializes the final screen after transient erase/repaint bytes', async () => {
      const state = createState()
      appendOutput(
        state,
        '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                            \r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J👾:~/repo\r\n$ ',
      )

      const snap = await replaySnapshot(state)

      expect(snap?.snapshot).toContain('👾:~/repo')
      expect(snap?.snapshot).toContain('$ ')
      expect(snap?.snapshot).not.toContain('\x1b[7m%')
      expect(snap).toMatchObject({ snapshotSeq: 1 })
    })

    test('queues resize into the same headless screen chain without changing the snapshot sequence', async () => {
      const state = createState()
      appendOutput(state, 'prompt')
      resizeRender(state, 100, 30)

      const snap = await replaySnapshot(state)

      expect(snap).toEqual({ snapshot: 'prompt', snapshotSeq: 1 })
    })

    test('serializes atomically before output queued after the snapshot request', async () => {
      const state = createState()
      const firstWriteCompleted = Promise.withResolvers<void>()
      const operations: string[] = []
      const originalWrite = state.screen.terminal.write.bind(state.screen.terminal)
      const write = vi.spyOn(state.screen.terminal, 'write').mockImplementation((data, callback) => {
        operations.push(`write:${String(data)}`)
        if (data === 'first') {
          firstWriteCompleted.promise.then(() => originalWrite(data, callback))
          return
        }
        originalWrite(data, callback)
      })
      const serialize = vi.spyOn(state.screen.serializer, 'serialize').mockImplementation(() => {
        operations.push('serialize')
        return 'first'
      })

      appendOutput(state, 'first')
      await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
      const snapshot = replaySnapshot(state)
      appendOutput(state, 'second')
      firstWriteCompleted.resolve()

      await expect(snapshot).resolves.toEqual({ snapshot: 'first', snapshotSeq: 1 })
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
      expect(serialize).toHaveBeenCalledOnce()
      expect(operations).toEqual(['write:first', 'serialize', 'write:second'])
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
