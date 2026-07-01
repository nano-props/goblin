import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTerminalOutputActivityState } from '#/web/components/terminal/terminal-output-activity-state.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('terminal output activity state', () => {
  test('does not enter active immediately after the first output sample', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
    const notify = vi.fn()
    const state = createTerminalOutputActivityState(notify)

    state.markOutput('session-1', 'worktree-1')

    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  test('enters active after output continues across the confirmation delay', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
    const notify = vi.fn()
    const state = createTerminalOutputActivityState(notify)

    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(2000)
    state.markOutput('session-1', 'worktree-1')

    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2999)
    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).not.toHaveBeenCalled()

    state.markOutput('session-1', 'worktree-1')
    expect(state.hasRecentOutput('session-1')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('worktree-1')
  })

  test('exits active as soon as the idle timeout elapses', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
    const notify = vi.fn()
    const state = createTerminalOutputActivityState(notify)

    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(2000)
    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(3000)
    state.markOutput('session-1', 'worktree-1')

    expect(state.hasRecentOutput('session-1')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(4999)
    expect(state.hasRecentOutput('session-1')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenLastCalledWith('worktree-1')
  })

  test('expires active output using monotonic time when the wall clock moves backward', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
    const notify = vi.fn()
    const state = createTerminalOutputActivityState(notify)

    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(2000)
    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(3000)
    state.markOutput('session-1', 'worktree-1')

    expect(state.hasRecentOutput('session-1')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    vi.setSystemTime(new Date('2026-06-29T00:00:00.000Z'))
    vi.advanceTimersByTime(3999)
    expect(state.hasRecentOutput('session-1')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenLastCalledWith('worktree-1')
  })

  test('keeps active visible until the idle timeout once shown', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
    const notify = vi.fn()
    const state = createTerminalOutputActivityState(notify)

    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(500)
    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(4500)
    state.markOutput('session-1', 'worktree-1')

    expect(state.hasRecentOutput('session-1')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(4999)
    expect(state.hasRecentOutput('session-1')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  test('extends the active idle timeout without notifying again', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
    const notify = vi.fn()
    const state = createTerminalOutputActivityState(notify)

    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(2000)
    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(3000)
    state.markOutput('session-1', 'worktree-1')

    expect(state.hasRecentOutput('session-1')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1999)
    state.markOutput('session-1', 'worktree-1')
    expect(notify).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(4999)
    expect(state.hasRecentOutput('session-1')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  test('re-entering active after exit requires a fresh confirmation delay', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
    const notify = vi.fn()
    const state = createTerminalOutputActivityState(notify)

    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(2000)
    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(3000)
    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(5000)

    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).toHaveBeenCalledTimes(2)

    state.markOutput('session-1', 'worktree-1')
    vi.advanceTimersByTime(2000)
    state.markOutput('session-1', 'worktree-1')

    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(2999)
    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(1)
    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).toHaveBeenCalledTimes(2)

    state.markOutput('session-1', 'worktree-1')
    expect(state.hasRecentOutput('session-1')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(3)
  })

  test('remove clears pending activity without an expiry notification', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
    const notify = vi.fn()
    const state = createTerminalOutputActivityState(notify)

    state.markOutput('session-1', 'worktree-1')
    state.remove('session-1')
    vi.advanceTimersByTime(5000)

    expect(state.hasRecentOutput('session-1')).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })
})
