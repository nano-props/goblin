import { describe, expect, test } from 'vitest'
import {
  appendOutput,
  createEmptyTerminalRenderState,
  resetRender,
  takeSnapshot,
} from '#/server/terminal/terminal-render-state.ts'

describe('terminal-render-state', () => {
  describe('appendOutput', () => {
    test('increments sequence and appends data without truncation when under limit', () => {
      const state = createEmptyTerminalRenderState()
      const seq1 = appendOutput(state, 'hello')
      expect(seq1).toBe(1)
      expect(state.sequence).toBe(1)
      expect(state.buffer).toBe('hello')
      expect(state.bufferTruncated).toBe(false)

      const seq2 = appendOutput(state, ' world')
      expect(seq2).toBe(2)
      expect(state.sequence).toBe(2)
      expect(state.buffer).toBe('hello world')
    })

    test('truncates the buffer to the last 16 MB and sets the truncated flag', () => {
      const state = createEmptyTerminalRenderState()
      const big = 'a'.repeat(20 * 1024 * 1024) // 20 MB
      appendOutput(state, big)
      expect(state.buffer.length).toBeLessThanOrEqual(16 * 1024 * 1024 + 10) // allow a small margin for the reset prefix
      expect(state.bufferTruncated).toBe(true)
    })

    test('keeps the tail end of a long buffer (recent data is preserved)', () => {
      const state = createEmptyTerminalRenderState()
      const prefix = 'x'.repeat(5 * 1024 * 1024)
      const suffix = 'tail-marker-12345'
      appendOutput(state, prefix + suffix)
      expect(state.buffer).toContain(suffix)
    })

    test('prefixes the truncated tail with a reset so the replay is safe to apply', () => {
      const state = createEmptyTerminalRenderState()
      const big = 'a'.repeat(20 * 1024 * 1024)
      appendOutput(state, big)
      // After truncation, the head is an ANSI reset so any truncated SGR
      // sequences from the cut point don't bleed into the replayed state.
      expect(state.buffer.startsWith('\x1b[0m')).toBe(true)
    })

    test('does not break surrogate pairs at the truncation boundary', () => {
      const state = createEmptyTerminalRenderState()
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
      const state = createEmptyTerminalRenderState()
      // \x1b[31m sets red; truncate so tail starts inside the sequence
      const pad = 'a'.repeat(16 * 1024 * 1024 - 3)
      appendOutput(state, pad + '\x1b[31mred-text')
      const afterReset = state.buffer.slice(4) // after \x1b[0m
      expect(afterReset.startsWith('\x1b[')).toBe(false)
      expect(state.buffer).toContain('red-text')
    })

    test('preserves a complete CSI sequence at the truncation boundary', () => {
      const state = createEmptyTerminalRenderState()
      const pad = 'a'.repeat(16 * 1024 * 1024 - 10)
      appendOutput(state, pad + '\x1b[38;2;255;0;0mcolor')
      expect(state.buffer).toContain('color')
    })

    test('prefers a line boundary for a clean visual cut', () => {
      const state = createEmptyTerminalRenderState()
      const line1 = 'first-line\n'
      const line2 = 'second-line\n'
      const line3 = 'third-line-tail'
      const pad = 'x'.repeat(16 * 1024 * 1024 - line1.length - line2.length - line3.length + 1)
      appendOutput(state, pad + line1 + line2 + line3)
      const afterReset = state.buffer.slice(4) // after \x1b[0m
      expect(afterReset.startsWith('second-line')).toBe(true)
    })

    test('handles a lone trailing ESC at the truncation boundary', () => {
      const state = createEmptyTerminalRenderState()
      // Fill the buffer with content ending in a bare ESC. The
      // truncation boundary must not leave `\x1b` as the very first
      // character of the tail, since that would be a malformed escape
      // for the client to parse.
      const pad = 'a'.repeat(16 * 1024 * 1024)
      appendOutput(state, pad + '\x1b')
      const afterReset = state.buffer.slice(4)
      expect(afterReset.charCodeAt(0)).not.toBe(0x1b)
    })
  })

  describe('title extraction', () => {
    test('captures the last OSC 0 title from a chunk', () => {
      const state = createEmptyTerminalRenderState()
      appendOutput(state, '\x1b]0;first title\x07more data')
      expect(state.title).toBe('first title')
      appendOutput(state, '\x1b]0;second title\x07')
      expect(state.title).toBe('second title')
    })

    test('treats OSC 2 the same as OSC 0', () => {
      const state = createEmptyTerminalRenderState()
      appendOutput(state, '\x1b]2;icon title\x07')
      expect(state.title).toBe('icon title')
    })

    test('clears the title when the shell emits an empty OSC string', () => {
      const state = createEmptyTerminalRenderState()
      appendOutput(state, '\x1b]0;a title\x07')
      expect(state.title).toBe('a title')
      appendOutput(state, '\x1b]0;\x07')
      expect(state.title).toBeNull()
    })

    test('leaves the title null when no OSC 0 sequence is present', () => {
      const state = createEmptyTerminalRenderState()
      appendOutput(state, 'plain text output')
      expect(state.title).toBeNull()
    })

    // Pin the deliberately-dropped behavior: OSC 0/2 sequences split
    // across two PTY writes are not reassembled. The shell typically
    // emits the full sequence in one write, but a misbehaving or
    // boundary-pushing program could split it. If we later want to
    // reassemble, this test is the contract to update.
    test('does not reassemble an OSC 0 sequence split across two appendOutput calls', () => {
      const state = createEmptyTerminalRenderState()
      appendOutput(state, '\x1b]0;~/Developer/goblin — ')
      expect(state.title).toBeNull()
      appendOutput(state, 'npm run dev\x07')
      expect(state.title).toBeNull()
    })
  })

  describe('takeSnapshot', () => {
    test('returns null when nothing has been appended', () => {
      const state = createEmptyTerminalRenderState()
      expect(takeSnapshot(state)).toBeNull()
    })

    test('returns the current buffer and sequence as the snapshot', () => {
      const state = createEmptyTerminalRenderState()
      appendOutput(state, 'a')
      appendOutput(state, 'b')
      const snap = takeSnapshot(state)
      expect(snap).toEqual({ snapshot: 'ab', snapshotSeq: 2, snapshotTruncated: false })
    })

    test('includes the truncated flag once the buffer has been truncated', () => {
      const state = createEmptyTerminalRenderState()
      appendOutput(state, 'a'.repeat(20 * 1024 * 1024))
      const snap = takeSnapshot(state)
      expect(snap).toBeTruthy()
      expect(snap!.snapshotTruncated).toBe(true)
    })
  })

  describe('resetRender', () => {
    test('clears the buffer, sequence, and title back to the initial state', () => {
      const state = createEmptyTerminalRenderState()
      appendOutput(state, 'history')
      appendOutput(state, '\x1b]0;a title\x07')
      resetRender(state)
      expect(state.sequence).toBe(0)
      expect(state.buffer).toBe('')
      expect(state.bufferTruncated).toBe(false)
      expect(state.title).toBeNull()
    })
  })
})
