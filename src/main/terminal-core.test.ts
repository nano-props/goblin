import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  closeAllTerminalSessions,
  closeOwnedTerminalSession,
  closeTerminalKey,
  closeTerminalOwner,
  openTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from '#/main/terminal-core.ts'
import { spawn } from 'node-pty'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mockWindows },
  app: { on: vi.fn() },
}))

interface MockPty {
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (data: string) => void
  emitExit: () => void
}

const mockPtys: MockPty[] = []
const mockWindows: Array<{
  webContents: { id: number; isDestroyed: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }
  isDestroyed: ReturnType<typeof vi.fn>
}> = []

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let onData: ((data: string) => void) | null = null
    let onExit: (() => void) | null = null
    const pty: MockPty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      emitData: (data) => onData?.(data),
      emitExit: () => onExit?.(),
    }
    mockPtys.push(pty)
    return {
      write: pty.write,
      resize: pty.resize,
      kill: pty.kill,
      onData: (cb: (data: string) => void) => {
        onData = cb
        return {
          dispose: vi.fn(() => {
            if (onData === cb) onData = null
          }),
        }
      },
      onExit: (cb: () => void) => {
        onExit = cb
        return {
          dispose: vi.fn(() => {
            if (onExit === cb) onExit = null
          }),
        }
      },
    }
  }),
}))

beforeEach(() => {
  closeAllTerminalSessions()
  mockPtys.length = 0
  mockWindows.length = 0
  vi.mocked(spawn).mockClear()
})

describe('terminal core sessions', () => {
  test('reuses worktree-scoped sessions and replays buffered output', () => {
    const first = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(1)

    mockPtys[0]!.emitData('hello')
    const second = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 100,
      rows: 30,
    })

    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.sessionId).toBe(first.sessionId)
      expect(second.replay).toBe('hello')
      expect(second.replaySeq).toBe(1)
    }
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]!.resize).toHaveBeenCalledWith(100, 30)
  })

  test('replaces worktree-scoped sessions when forceNew is requested', () => {
    const first = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)
    mockPtys[0]!.emitData('old output')

    const replaced = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 100,
      rows: 30,
      forceNew: true,
    })

    expect(replaced.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(mockPtys[0]!.kill).toHaveBeenCalledTimes(1)
    if (!first.ok || !replaced.ok) return
    expect(replaced.sessionId).not.toBe(first.sessionId)
    expect(replaced.replay).toBe('')
    expect(replaced.replaySeq).toBe(0)

    writeTerminalSession(1, first.sessionId, 'stale input')
    writeTerminalSession(1, replaced.sessionId, 'fresh input')
    expect(mockPtys[0]!.write).not.toHaveBeenCalled()
    expect(mockPtys[1]!.write).toHaveBeenCalledWith('fresh input')

    mockPtys[0]!.emitData('ignored')
    mockPtys[1]!.emitData('fresh output')
    const reused = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 100,
      rows: 30,
    })
    expect(reused.ok).toBe(true)
    if (reused.ok) {
      expect(reused.sessionId).toBe(replaced.sessionId)
      expect(reused.replay).toBe('fresh output')
      expect(reused.replaySeq).toBe(1)
    }
  })

  test('dedupes writes and resizes for closed or unchanged sessions', () => {
    const opened = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    writeTerminalSession(1, opened.sessionId, 'x')
    resizeTerminalSession(1, opened.sessionId, 80, 24)
    resizeTerminalSession(1, opened.sessionId, 81, 24)
    closeAllTerminalSessions()
    writeTerminalSession(1, opened.sessionId, 'y')
    resizeTerminalSession(1, opened.sessionId, 82, 24)

    expect(mockPtys[0]!.write).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]!.write).toHaveBeenCalledWith('x')
    expect(mockPtys[0]!.resize).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]!.resize).toHaveBeenCalledWith(81, 24)
    expect(mockPtys[0]!.kill).toHaveBeenCalledTimes(1)
  })

  test('reopens cleanly after spawn failures', () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('spawn failed')
    })

    const failed = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    const reopened = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })

    expect(failed).toEqual({ ok: false, message: 'spawn failed' })
    expect(reopened.ok).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(mockPtys).toHaveLength(1)
  })

  test('removes exited sessions and opens a fresh terminal for the worktree', () => {
    const opened = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    mockPtys[0]!.emitData('before exit')
    mockPtys[0]!.emitExit()
    writeTerminalSession(1, opened.sessionId, 'after exit')
    resizeTerminalSession(1, opened.sessionId, 100, 30)

    const reopened = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 100,
      rows: 30,
    })

    expect(reopened.ok).toBe(true)
    if (reopened.ok) {
      expect(reopened.sessionId).not.toBe(opened.sessionId)
      expect(reopened.replay).toBe('')
      expect(reopened.replaySeq).toBe(0)
    }
    expect(mockPtys[0]!.write).not.toHaveBeenCalled()
    expect(mockPtys[0]!.resize).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  test('closes sessions by key', () => {
    const first = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/one',
      cwd: '/one',
      cols: 80,
      rows: 24,
    })
    const second = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/two',
      cwd: '/two',
      cols: 80,
      rows: 24,
    })
    expect(first.ok && second.ok).toBe(true)

    closeTerminalKey('/repo\0/one')
    if (first.ok) writeTerminalSession(1, first.sessionId, 'closed')
    if (second.ok) writeTerminalSession(1, second.sessionId, 'open')
    expect(mockPtys[0]!.kill).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]!.write).not.toHaveBeenCalled()
    expect(mockPtys[1]!.write).toHaveBeenCalledWith('open')
  })

  test('scopes reuse and output delivery by owner webContents', () => {
    const first = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    const second = openTerminalSession({
      ownerWebContentsId: 2,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.sessionId).not.toBe(second.sessionId)

    const ownerOne = mockWindow(1)
    const ownerTwo = mockWindow(2)
    mockWindows.push(ownerOne, ownerTwo)
    mockPtys[0]!.emitData('owner one')
    mockPtys[1]!.emitData('owner two')

    expect(ownerOne.webContents.send).toHaveBeenCalledWith('goblin:terminal-output', {
      sessionId: first.sessionId,
      data: 'owner one',
      seq: 1,
    })
    expect(ownerOne.webContents.send).not.toHaveBeenCalledWith(
      'goblin:terminal-output',
      expect.objectContaining({ sessionId: second.sessionId }),
    )
    expect(ownerTwo.webContents.send).toHaveBeenCalledWith('goblin:terminal-output', {
      sessionId: second.sessionId,
      data: 'owner two',
      seq: 1,
    })
  })

  test('ignores terminal output when the owner window is destroyed', () => {
    const opened = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(opened.ok).toBe(true)

    const owner = mockWindow(1)
    owner.isDestroyed.mockReturnValue(true)
    mockWindows.push(owner)

    expect(() => mockPtys[0]!.emitData('late output')).not.toThrow()
    expect(owner.webContents.send).not.toHaveBeenCalled()
  })

  test('scopes writes, resizes, and direct closes by owner webContents', () => {
    const first = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    const second = openTerminalSession({
      ownerWebContentsId: 2,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    writeTerminalSession(2, first.sessionId, 'wrong owner')
    resizeTerminalSession(2, first.sessionId, 100, 30)
    closeOwnedTerminalSession(2, first.sessionId)
    expect(mockPtys[0]!.write).not.toHaveBeenCalled()
    expect(mockPtys[0]!.resize).not.toHaveBeenCalled()
    expect(mockPtys[0]!.kill).not.toHaveBeenCalled()

    writeTerminalSession(1, first.sessionId, 'right owner')
    resizeTerminalSession(1, first.sessionId, 100, 30)
    closeOwnedTerminalSession(1, first.sessionId)
    writeTerminalSession(1, first.sessionId, 'closed')

    expect(mockPtys[0]!.write).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]!.write).toHaveBeenCalledWith('right owner')
    expect(mockPtys[0]!.resize).toHaveBeenCalledWith(100, 30)
    expect(mockPtys[0]!.kill).toHaveBeenCalledTimes(1)
    expect(mockPtys[1]!.kill).not.toHaveBeenCalled()
  })

  test('prunes repo sessions only for the requested owner webContents', async () => {
    const core = await import('#/main/terminal-core.ts')
    const first = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    const second = openTerminalSession({
      ownerWebContentsId: 2,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    core.pruneTerminalScope(1, '/repo', new Set())
    writeTerminalSession(1, first.sessionId, 'closed')
    writeTerminalSession(2, second.sessionId, 'open')

    expect(mockPtys[0]!.kill).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]!.write).not.toHaveBeenCalled()
    expect(mockPtys[1]!.kill).not.toHaveBeenCalled()
    expect(mockPtys[1]!.write).toHaveBeenCalledWith('open')
  })

  test('continues after PTY resize failures', () => {
    const opened = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    mockPtys[0]!.resize.mockImplementationOnce(() => {
      throw new Error('resize failed')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => resizeTerminalSession(1, opened.sessionId, 100, 30)).not.toThrow()
    writeTerminalSession(1, opened.sessionId, 'still alive')

    expect(warnSpy).toHaveBeenCalledWith('[terminal] failed to resize PTY', expect.any(Error))
    expect(mockPtys[0]!.resize).toHaveBeenCalledWith(100, 30)
    expect(mockPtys[0]!.write).toHaveBeenCalledWith('still alive')
  })

  test('continues after PTY write failures', () => {
    const opened = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/worktree',
      cwd: '/worktree',
      cols: 80,
      rows: 24,
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    mockPtys[0]!.write.mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => writeTerminalSession(1, opened.sessionId, 'input')).not.toThrow()
    writeTerminalSession(1, opened.sessionId, 'still alive')

    expect(warnSpy).toHaveBeenCalledWith('[terminal] failed to write PTY', expect.any(Error))
    expect(mockPtys[0]!.write).toHaveBeenCalledWith('input')
    expect(mockPtys[0]!.write).toHaveBeenCalledWith('still alive')
  })

  test('closes all sessions owned by a webContents', () => {
    const first = openTerminalSession({
      ownerWebContentsId: 1,
      scope: '/repo',
      key: '/repo\0/one',
      cwd: '/one',
      cols: 80,
      rows: 24,
    })
    const second = openTerminalSession({
      ownerWebContentsId: 2,
      scope: '/repo',
      key: '/repo\0/two',
      cwd: '/two',
      cols: 80,
      rows: 24,
    })
    expect(first.ok && second.ok).toBe(true)

    closeTerminalOwner(1)
    if (first.ok) writeTerminalSession(1, first.sessionId, 'closed')
    if (second.ok) writeTerminalSession(2, second.sessionId, 'open')

    expect(mockPtys[0]!.kill).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]!.write).not.toHaveBeenCalled()
    expect(mockPtys[1]!.kill).not.toHaveBeenCalled()
    expect(mockPtys[1]!.write).toHaveBeenCalledWith('open')
  })
})

function mockWindow(id: number) {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      id,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  }
}
