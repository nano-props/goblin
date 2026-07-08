import { describe, expect, test, vi } from 'vitest'
import { buildTerminalWorktreeSnapshot } from '#/web/components/terminal/terminal-session-worktree-snapshot.ts'
import type { TerminalSessionLike, TerminalDescriptor, TerminalSnapshot } from '#/web/components/terminal/types.ts'

function makeDescriptor(terminalSessionId: string, index: number): TerminalDescriptor {
  return {
    terminalSessionId: `/repo\0/repo\0${terminalSessionId}`,
    terminalWorktreeKey: '/repo\0/repo',
    index,
    repoRoot: '/repo',
    repoInstanceId: 'repo-instance-test',
    branch: 'main',
    worktreePath: '/repo',
  }
}

function makeSession(
  descriptor: TerminalDescriptor,
  snapshot: TerminalSnapshot,
): TerminalSessionLike & { snapshotSpy: ReturnType<typeof vi.fn> } {
  const snapshotSpy = vi.fn(() => snapshot)
  return {
    descriptor,
    updateDescriptor: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    disposeAndWait: vi.fn(async () => {}),
    snapshot: snapshotSpy,
    isTerminalFocusTarget: vi.fn(() => false),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearSearch: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollLines: vi.fn(),
    writeInput: vi.fn(),
    takeover: vi.fn(),
    handleIdentity: vi.fn(),
    handleLifecycle: vi.fn(),
    handleOutput: vi.fn(),
    handleServerTitle: vi.fn(),
    handleExit: vi.fn(() => false),
    snapshotSpy,
  }
}

describe('terminal session worktree snapshot helper', () => {
  test('builds summaries and populates snapshot cache lazily', () => {
    const descriptor = makeDescriptor('session-1', 1)
    const session = makeSession(descriptor, {
      phase: 'open',
      message: null,
      processName: 'bash',
      canonicalTitle: 'npm run dev',
    })
    const cache = new Map<string, TerminalSnapshot>()

    const snapshot = buildTerminalWorktreeSnapshot({
      terminalWorktreeKey: descriptor.terminalWorktreeKey,
      selectedDescriptor: descriptor,
      createPending: false,
      sessions: [session],
      selectedTerminalSessionId: descriptor.terminalSessionId,
      getCachedSnapshot: (terminalSessionId) => cache.get(terminalSessionId) ?? null,
      cacheSnapshot: (terminalSessionId, value) => cache.set(terminalSessionId, value),
      hasBell: () => true,
      hasRecentOutput: () => true,
    })

    expect(snapshot).toEqual({
      terminalWorktreeKey: descriptor.terminalWorktreeKey,
      selectedDescriptor: descriptor,
      sessions: [
        expect.objectContaining({
          type: 'terminal',
          terminalSessionId: descriptor.terminalSessionId,
          selected: true,
          hasBell: true,
          hasRecentOutput: true,
          phase: 'open',
          originalTitle: 'npm run dev',
        }),
      ],
      count: 1,
      bellCount: 1,
      outputActiveCount: 1,
      createPending: false,
    })
    expect(session.snapshotSpy).toHaveBeenCalledTimes(1)

    buildTerminalWorktreeSnapshot({
      terminalWorktreeKey: descriptor.terminalWorktreeKey,
      selectedDescriptor: descriptor,
      createPending: false,
      sessions: [session],
      selectedTerminalSessionId: descriptor.terminalSessionId,
      getCachedSnapshot: (terminalSessionId) => cache.get(terminalSessionId) ?? null,
      cacheSnapshot: (terminalSessionId, value) => cache.set(terminalSessionId, value),
      hasBell: () => false,
      hasRecentOutput: () => false,
    })
    expect(session.snapshotSpy).toHaveBeenCalledTimes(1)
  })

  test('projects closing terminal session ids when present', () => {
    const descriptor = makeDescriptor('session-1', 1)
    const session = makeSession(descriptor, {
      phase: 'open',
      message: null,
      processName: 'bash',
    })
    const snapshot = buildTerminalWorktreeSnapshot({
      terminalWorktreeKey: descriptor.terminalWorktreeKey,
      selectedDescriptor: null,
      createPending: false,
      closingSessionIds: [descriptor.terminalSessionId],
      sessions: [session],
      selectedTerminalSessionId: null,
      getCachedSnapshot: () => null,
      cacheSnapshot: () => {},
      hasBell: () => false,
      hasRecentOutput: () => false,
    })

    expect(snapshot.closingSessionIds).toEqual([descriptor.terminalSessionId])
  })
})
