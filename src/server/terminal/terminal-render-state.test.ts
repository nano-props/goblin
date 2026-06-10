import { describe, expect, test } from 'vitest'
import { createEmptyTerminalRenderState, appendTerminalReplayData } from '#/server/terminal/terminal-render-state.ts'

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
})
