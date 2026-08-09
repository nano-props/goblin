import { describe, expect, test } from 'vitest'
import {
  createEmptyTerminalControlSequenceScannerState,
  scanTerminalControlSequences,
} from '#/server/terminal/terminal-control-sequence-scanner.ts'

describe('terminal-control-sequence-scanner', () => {
  test('detects a plain BEL control character', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('done\x07', state).events).toEqual([{ type: 'bell' }])
  })

  test('does not treat BEL-terminated OSC title as a terminal bell', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x1b]0;~/repo\x07', state).events).toEqual([
      { type: 'title', title: '~/repo' },
    ])
  })

  test('preserves title and bell order within a chunk', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x1b]0;~/repo\x07done\x07', state).events).toEqual([
      { type: 'title', title: '~/repo' },
      { type: 'bell' },
    ])
  })

  test('preserves bell before title order within a chunk', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x07\x1b]0;~/repo\x07', state).events).toEqual([
      { type: 'bell' },
      { type: 'title', title: '~/repo' },
    ])
  })

  test('preserves title, bell, title order within a chunk', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x1b]0;first\x07\x07\x1b]2;second\x07', state).events).toEqual([
      { type: 'title', title: 'first' },
      { type: 'bell' },
      { type: 'title', title: 'second' },
    ])
  })

  test('does not treat ST-terminated OSC content as a terminal bell', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x1b]0;~/repo\x1b\\', state).events).toEqual([
      { type: 'title', title: '~/repo' },
    ])
  })

  test('does not treat C1 OSC content as a terminal bell', () => {
    const belState = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x9d0;~/repo\x07done', belState).events).toEqual([
      { type: 'title', title: '~/repo' },
    ])
    const stState = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x9d0;~/repo\x9cdone\x07', stState).events).toEqual([
      { type: 'title', title: '~/repo' },
      { type: 'bell' },
    ])
  })

  test('carries C1 OSC state across chunks so split title terminators are not terminal bells', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x9d0;~/repo', state).events).toEqual([])
    expect(scanTerminalControlSequences('\x07done\x07', state).events).toEqual([
      { type: 'title', title: '~/repo' },
      { type: 'bell' },
    ])
  })

  test('carries OSC state across chunks so split title terminators are not terminal bells', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x1b]0;~/repo', state).events).toEqual([])
    expect(scanTerminalControlSequences('\x07', state).events).toEqual([{ type: 'title', title: '~/repo' }])
  })

  test('continues scanning after a bell so later split OSC state is preserved', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x07\x1b]0;~/repo', state).events).toEqual([{ type: 'bell' }])
    expect(scanTerminalControlSequences('\x07', state).events).toEqual([{ type: 'title', title: '~/repo' }])
  })

  test('carries a split ESC before OSC start across chunks', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x1b', state).events).toEqual([])
    expect(scanTerminalControlSequences(']0;~/repo\x07', state).events).toEqual([{ type: 'title', title: '~/repo' }])
  })

  test('ends OSC at ESC and swallows the second byte of a split 7-bit ST', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x1b]0;~/repo\x1b', state).events).toEqual([
      { type: 'title', title: '~/repo' },
    ])
    expect(scanTerminalControlSequences('\\done\x07', state).events).toEqual([{ type: 'bell' }])
  })

  test('keeps an earlier title in a chunk when a later unsupported OSC finishes', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x1b]0;devin: hello\x07\x1b]30;devin: hello\x07', state).events).toEqual([
      { type: 'title', title: 'devin: hello' },
    ])
  })

  test('does not apply an OSC title aborted by CAN or SUB', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences('\x1b]0;aborted\x18', state).events).toEqual([])
    expect(scanTerminalControlSequences('\x1b]2;also aborted\x1a', state).events).toEqual([])
  })

  test('drops overlong titles and recovers for the next OSC title', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences(`\x1b]0;${'a'.repeat(4097)}\x07`, state).events).toEqual([])
    expect(scanTerminalControlSequences('\x1b]0;recovered\x07', state).events).toEqual([
      { type: 'title', title: 'recovered' },
    ])
  })

  test('drops overlong titles split across chunks and recovers after termination', () => {
    const state = createEmptyTerminalControlSequenceScannerState()
    expect(scanTerminalControlSequences(`\x1b]0;${'a'.repeat(4096)}`, state).events).toEqual([])
    expect(scanTerminalControlSequences('a\x07', state).events).toEqual([])
    expect(scanTerminalControlSequences('\x1b]2;next\x07', state).events).toEqual([{ type: 'title', title: 'next' }])
  })
})
