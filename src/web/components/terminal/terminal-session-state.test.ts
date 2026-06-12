import { describe, expect, test } from 'vitest'
import { TerminalSessionState } from '#/web/components/terminal/terminal-session-state.ts'

describe('TerminalSessionState', () => {
  test('tracks snapshot and attachment state transitions', () => {
    const state = new TerminalSessionState()

    expect(state.snapshot(null)).toEqual({
      phase: 'opening',
      message: null,
      processName: 'terminal',
      canonicalTitle: null,
    })
    expect(
      state.applyOpenResult({
        processName: 'zsh',
        canonicalTitle: '~/Developer/goblin — npm run dev',
        role: 'viewer',
        controllerStatus: 'connected',
        canonicalCols: 120,
        canonicalRows: 40,
      }),
    ).toBe(true)
    expect(state.setOpen()).toBe(true)
    expect(state.snapshot('session-1')).toEqual({
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      attachment: {
        role: 'viewer',
        controllerStatus: 'connected',
        active: false,
        canTakeover: true,
        canonicalCols: 120,
        canonicalRows: 40,
      },
    })
  })

  test('buffers replay output until replay completes', () => {
    const state = new TerminalSessionState()

    state.beginReplay(3)
    expect(state.captureReplayOutput({ sessionId: 'session-1', data: 'old', seq: 2, processName: 'zsh' })).toBe(true)
    expect(state.captureReplayOutput({ sessionId: 'session-1', data: 'new', seq: 4, processName: 'zsh' })).toBe(true)

    expect(state.finishReplay()).toEqual([{ sessionId: 'session-1', data: 'new', seq: 4, processName: 'zsh' }])
    expect(state.captureReplayOutput({ sessionId: 'session-1', data: 'live', seq: 5, processName: 'zsh' })).toBe(false)
  })

  test('resetTransientState clears transient state without overwriting ownership', () => {
    const state = new TerminalSessionState()

    state.applyOpenResult({
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      role: 'viewer',
      controllerStatus: 'grace',
      canonicalCols: 120,
      canonicalRows: 40,
    })
    state.setOpen()
    state.beginReplay(1)
    state.captureReplayOutput({ sessionId: 'session-1', data: 'live', seq: 2, processName: 'zsh' })
    state.setSearchResult({ resultIndex: 0, resultCount: 1, found: true })
    state.setProgress(1, 10)

    expect(state.resetTransientState()).toBe(true)
    expect(state.snapshot('session-1')).toEqual({
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: '~/Developer/goblin — npm run dev',
      attachment: {
        role: 'viewer',
        controllerStatus: 'grace',
        active: false,
        canTakeover: true,
        canonicalCols: 120,
        canonicalRows: 40,
      },
    })
  })

  test('normalizes empty titles back to null', () => {
    const state = new TerminalSessionState()

    expect(state.setCanonicalTitle('  hello   world  ')).toBe(true)
    expect(state.snapshot(null).canonicalTitle).toBe('hello world')
    expect(state.setCanonicalTitle('   ')).toBe(true)
    expect(state.snapshot(null).canonicalTitle).toBeNull()
  })
})
