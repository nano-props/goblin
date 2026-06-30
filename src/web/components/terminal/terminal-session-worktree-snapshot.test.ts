import { describe, expect, test, vi } from 'vitest'
import { buildTerminalWorktreeSnapshot } from '#/web/components/terminal/terminal-session-worktree-snapshot.ts'
import type { TerminalSessionLike, TerminalDescriptor, TerminalSnapshot } from '#/web/components/terminal/types.ts'

function makeDescriptor(sessionId: string, index: number): TerminalDescriptor {
  return {
    terminalKey: `/repo\0/repo\0${sessionId}`,
    terminalWorktreeKey: '/repo\0/repo',
    sessionId,
    index,
    repoRoot: '/repo',
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
    serialize: vi.fn(() => ''),
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
      pendingCreate: false,
      sessions: [session],
      selectedTerminalKey: descriptor.terminalKey,
      getCachedSnapshot: (terminalKey) => cache.get(terminalKey) ?? null,
      cacheSnapshot: (terminalKey, value) => cache.set(terminalKey, value),
      getDisplayOrder: () => 1,
      hasBell: () => true,
      hasRecentActivity: () => true,
    })

    expect(snapshot).toEqual({
      terminalWorktreeKey: descriptor.terminalWorktreeKey,
      selectedDescriptor: descriptor,
      sessions: [
        expect.objectContaining({
          type: 'terminal',
          terminalKey: descriptor.terminalKey,
          sessionId: 'session-1',
          selected: true,
          hasBell: true,
          recentlyActive: true,
          phase: 'open',
          originalTitle: 'npm run dev',
        }),
      ],
      count: 1,
      bellCount: 1,
      activeCount: 1,
      pendingCreate: false,
    })
    expect(session.snapshotSpy).toHaveBeenCalledTimes(1)

    buildTerminalWorktreeSnapshot({
      terminalWorktreeKey: descriptor.terminalWorktreeKey,
      selectedDescriptor: descriptor,
      pendingCreate: false,
      sessions: [session],
      selectedTerminalKey: descriptor.terminalKey,
      getCachedSnapshot: (terminalKey) => cache.get(terminalKey) ?? null,
      cacheSnapshot: (terminalKey, value) => cache.set(terminalKey, value),
      getDisplayOrder: () => 1,
      hasBell: () => false,
      hasRecentActivity: () => false,
    })
    expect(session.snapshotSpy).toHaveBeenCalledTimes(1)
  })
})
