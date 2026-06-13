import { describe, expect, test, vi } from 'vitest'
import {
  appendTerminalReplayData,
  createEmptyTerminalRenderState,
  createTerminalRenderModel,
  queueTerminalRenderClearAndResize,
  queueTerminalRenderResize,
  snapshotTerminalRenderState,
  type HeadlessTerminalLike,
  type TerminalRenderState,
} from '#/server/terminal/terminal-render-state.ts'

describe('terminal-render-state', () => {
  describe('appendTerminalReplayData', () => {
    test('increments sequence and appends data without truncation when under limit', () => {
      const state = createEmptyTerminalRenderState()
      const seq1 = appendTerminalReplayData(state, 'hello')
      expect(seq1).toBe(1)
      expect(state.buffer).toBe('hello')
      expect(state.bufferTruncated).toBe(false)

      const seq2 = appendTerminalReplayData(state, ' world')
      expect(seq2).toBe(2)
      expect(state.buffer).toBe('hello world')
      expect(state.bufferTruncated).toBe(false)
    })

    test('truncates to maxChars and sets bufferTruncated flag', () => {
      const state = createEmptyTerminalRenderState()
      const big = 'a'.repeat(20 * 1024 * 1024) // 20 MB, over 16 MB limit
      appendTerminalReplayData(state, big)
      expect(state.buffer.length).toBeLessThanOrEqual(16 * 1024 * 1024 + 10) // allow margin for reset prefix
      expect(state.bufferTruncated).toBe(true)
    })

    test('preserves the tail of a long buffer', () => {
      const state = createEmptyTerminalRenderState()
      const prefix = 'x'.repeat(5 * 1024 * 1024)
      const suffix = 'tail-marker-12345'
      appendTerminalReplayData(state, prefix + suffix)
      expect(state.buffer).toContain(suffix)
    })

    test('prefixes ANSI reset after truncation for state safety', () => {
      const state = createEmptyTerminalRenderState()
      const big = 'a'.repeat(20 * 1024 * 1024)
      appendTerminalReplayData(state, big)
      expect(state.buffer.startsWith('\x1b[0m')).toBe(true)
    })

    test('does not break surrogate pairs at truncation boundary', () => {
      const state = createEmptyTerminalRenderState()
      // Build a string where a surrogate pair sits exactly at the 16 MB boundary
      const pad = 'a'.repeat(16 * 1024 * 1024 - 1)
      const pair = '\uD83D\uDE00' // 😀
      appendTerminalReplayData(state, pad + pair + 'tail')
      expect(state.buffer).toContain('tail')
      // Should not contain a lone high or low surrogate at start of tail
      const tailStart = state.buffer.indexOf('\x1b[0m') + 5
      const firstCode = state.buffer.charCodeAt(tailStart)
      const isLoneLow = firstCode >= 0xdc00 && firstCode <= 0xdfff
      expect(isLoneLow).toBe(false)
    })

    test('strips incomplete CSI sequence at truncation boundary', () => {
      const state = createEmptyTerminalRenderState()
      // \x1b[31m sets red; truncate so tail starts inside the sequence
      const pad = 'a'.repeat(16 * 1024 * 1024 - 3)
      appendTerminalReplayData(state, pad + '\x1b[31mred-text')
      // Tail should not start with an incomplete ESC sequence
      const afterReset = state.buffer.slice(5) // after \x1b[0m
      expect(afterReset.startsWith('\x1b[')).toBe(false)
      expect(state.buffer).toContain('red-text')
    })

    test('preserves complete CSI sequence at truncation boundary', () => {
      const state = createEmptyTerminalRenderState()
      const pad = 'a'.repeat(16 * 1024 * 1024 - 10)
      appendTerminalReplayData(state, pad + '\x1b[38;2;255;0;0mcolor')
      expect(state.buffer).toContain('color')
    })

    test('prefers line boundary for clean visual cut', () => {
      const state = createEmptyTerminalRenderState()
      const line1 = 'first-line\n'
      const line2 = 'second-line\n'
      const line3 = 'third-line-tail'
      const pad = 'x'.repeat(16 * 1024 * 1024 - line1.length - line2.length - line3.length + 1)
      appendTerminalReplayData(state, pad + line1 + line2 + line3)
      // Truncation discards the first line in the tail (it may be partial at the cut boundary)
      // \x1b[0m is 4 chars
      const afterReset = state.buffer.slice(4)
      expect(afterReset.startsWith('second-line')).toBe(true)
    })
  })

  describe('queueTerminalRenderClearAndResize', () => {
    function makeStateWithMock(): {
      state: TerminalRenderState
      term: HeadlessTerminalLike
      events: string[]
    } {
      const events: string[] = []
      const term: HeadlessTerminalLike = {
        write: vi.fn((data: string, cb?: () => void) => {
          events.push(`write:${JSON.stringify(data)}`)
          cb?.()
        }),
        resize: vi.fn((cols: number, rows: number) => {
          events.push(`resize:${cols}x${rows}`)
        }),
        loadAddon: vi.fn(),
        onTitleChange: vi.fn(() => ({ dispose() {} })),
        dispose: vi.fn(),
      }
      const state = createEmptyTerminalRenderState()
      state.model = createTerminalRenderModel(80, 24)
      state.model!.term = term
      return { state, term, events }
    }

    test('writes CSI 2J then resizes the headless, in that order', async () => {
      const { state, term } = makeStateWithMock()
      queueTerminalRenderClearAndResize(state, 100, 30)
      await state.model!.chain
      const writeOrder = (term.write as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
      const resizeOrder = (term.resize as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
      expect(writeOrder).toBeLessThan(resizeOrder)
      // write is called with (data, callback) so the chain step resolves only
      // after the headless has actually applied the wipe.
      expect((term.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('\x1b[2J')
      expect(typeof (term.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe('function')
      expect((term.resize as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([100, 30])
    })

    test('runs the wipe-then-resize in a single chain step (not split across ticks)', async () => {
      const { state, events } = makeStateWithMock()
      queueTerminalRenderClearAndResize(state, 100, 30)
      await state.model!.chain
      // The write is invoked synchronously inside the .then() with a
      // callback. The mock calls the callback immediately, so resize runs
      // before the chain step resolves.
      expect(events).toEqual(['write:"\\u001b[2J"', 'resize:100x30'])
    })

    test('runs after prior queued writes (chain is ordered)', async () => {
      const { state, events } = makeStateWithMock()
      // Pretend a prior write was queued (but never awaited)
      state.model!.chain = state.model!.chain.then(() => {
        events.push('prior-write')
      })
      queueTerminalRenderClearAndResize(state, 100, 30)
      await state.model!.chain
      expect(events).toEqual(['prior-write', 'write:"\\u001b[2J"', 'resize:100x30'])
    })

    test('runs before a write queued after it (re-paint sees new size)', async () => {
      const { state, events } = makeStateWithMock()
      queueTerminalRenderClearAndResize(state, 100, 30)
      // Simulate the PTY.onData re-paint arriving via the chain after SIGWINCH
      state.model!.chain = state.model!.chain.then(
        () =>
          new Promise<void>((resolve) => {
            state.model!.term.write('\x1b[H% ', () => {
              events.push('repaint-written')
              resolve()
            })
          }),
      )
      await state.model!.chain
      const clearIdx = events.indexOf('write:"\\u001b[2J"')
      const resizeIdx = events.indexOf('resize:100x30')
      const repaintIdx = events.indexOf('repaint-written')
      expect(clearIdx).toBeGreaterThanOrEqual(0)
      expect(resizeIdx).toBeGreaterThan(clearIdx)
      expect(repaintIdx).toBeGreaterThan(resizeIdx)
    })

    test('is a no-op when no model is bound', () => {
      const state = createEmptyTerminalRenderState()
      expect(() => queueTerminalRenderClearAndResize(state, 100, 30)).not.toThrow()
    })

    test('uses the captured model even if the state is rebound before the chain settles', async () => {
      const original = makeStateWithMock()
      queueTerminalRenderClearAndResize(original.state, 100, 30)
      const capturedChain = original.state.model!.chain
      // Simulate a session restart: rebind state.model to a new model
      const replacement = makeStateWithMock()
      original.state.model = replacement.state.model
      await capturedChain
      const origWrite = original.term.write as ReturnType<typeof vi.fn>
      const replWrite = replacement.term.write as ReturnType<typeof vi.fn>
      expect(origWrite).toHaveBeenCalledWith('\x1b[2J', expect.any(Function))
      expect(replWrite).not.toHaveBeenCalled()
    })
  })

  describe('queueTerminalRenderResize (regression)', () => {
    test('still resizes without erasing (legacy semantics preserved)', async () => {
      const term: HeadlessTerminalLike = {
        write: vi.fn(),
        resize: vi.fn(),
        loadAddon: vi.fn(),
        onTitleChange: vi.fn(() => ({ dispose() {} })),
        dispose: vi.fn(),
      }
      const state = createEmptyTerminalRenderState()
      state.model = createTerminalRenderModel(80, 24)
      state.model!.term = term
      queueTerminalRenderResize(state, 100, 30)
      await state.model!.chain
      expect(term.write).not.toHaveBeenCalled()
      expect(term.resize).toHaveBeenCalledWith(100, 30)
    })
  })

  describe('snapshotTerminalRenderState (seq timing)', () => {
    test('captures snapshotSeq AFTER the chain drains, so a write queued during the await is reflected in the seq', async () => {
      // Simulate the production timing:
      //   1. snapshotTerminalRenderState starts
      //   2. await chain is pending
      //   3. while awaiting, appendTerminalReplayData fires and bumps the seq
      //   4. chain resolves, snapshot reads the new seq
      // The seq in the returned snapshot must reflect the appended data,
      // otherwise the client's dedup boundary is set too low and the same
      // data is sent again as a live `output` event, producing a
      // duplicated prompt on re-attach.
      const state = createEmptyTerminalRenderState()
      state.model = createTerminalRenderModel(80, 24)
      const realChain = state.model.chain
      const snapshotPromise = snapshotTerminalRenderState('session-1', state)
      // While the snapshot is awaiting the chain, simulate a write whose
      // seq gets bumped. This mirrors pty.onData firing during the
      // production attach flow.
      state.sequence += 1
      await realChain
      const snapshot = await snapshotPromise
      expect(snapshot).toBeTruthy()
      expect(snapshot!.snapshotSeq).toBe(1)
    })
  })
})
