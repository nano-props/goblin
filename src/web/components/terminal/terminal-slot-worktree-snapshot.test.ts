import { describe, expect, test, vi } from 'vitest'
import { buildWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-slot-worktree-snapshot.ts'
import type {
  ManagedTerminalSessionLike,
  TerminalDescriptor,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'

function makeDescriptor(slotId: string, index: number): TerminalDescriptor {
  return {
    key: `/repo\0/repo\0${slotId}`,
    worktreeTerminalKey: '/repo\0/repo',
    slotId,
    index,
    repoRoot: '/repo',
    branch: 'main',
    worktreePath: '/repo',
  }
}

function makeSession(
  descriptor: TerminalDescriptor,
  snapshot: TerminalSnapshot,
): ManagedTerminalSessionLike & { snapshotSpy: ReturnType<typeof vi.fn> } {
  const snapshotSpy = vi.fn(() => snapshot)
  return {
    descriptor,
    updateDescriptor: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    dispose: vi.fn(),
    snapshot: snapshotSpy,
    isTerminalFocusTarget: vi.fn(() => false),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearSearch: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollLines: vi.fn(),
    writeInput: vi.fn(),
    takeover: vi.fn(),
    handleOwnership: vi.fn(),
    serialize: vi.fn(() => ''),
    handleOutput: vi.fn(),
    handleServerTitle: vi.fn(),
    handleExit: vi.fn(() => false),
    snapshotSpy,
  }
}

describe('terminal session worktree snapshot helper', () => {
  test('builds summaries and populates snapshot cache lazily', () => {
    const descriptor = makeDescriptor('slot-1', 1)
    const session = makeSession(descriptor, {
      phase: 'open',
      message: null,
      processName: 'bash',
      canonicalTitle: 'npm run dev',
    })
    const cache = new Map<string, TerminalSnapshot>()

    const snapshot = buildWorktreeTerminalSnapshot({
      worktreeTerminalKey: descriptor.worktreeTerminalKey,
      selectedDescriptor: descriptor,
      pendingCreate: false,
      sessions: [session],
      selectedKey: descriptor.key,
      getCachedSnapshot: (key) => cache.get(key) ?? null,
      cacheSnapshot: (key, value) => cache.set(key, value),
      getDisplayOrder: () => 1,
      hasBell: () => true,
    })

    expect(snapshot).toEqual({
      worktreeTerminalKey: descriptor.worktreeTerminalKey,
      selectedDescriptor: descriptor,
      sessions: [
        expect.objectContaining({
          type: 'terminal',
          id: descriptor.key,
          key: descriptor.key,
          slotId: 'slot-1',
          selected: true,
          hasBell: true,
          phase: 'open',
          originalTitle: 'npm run dev',
        }),
      ],
      count: 1,
      bellCount: 1,
      pendingCreate: false,
    })
    expect(session.snapshotSpy).toHaveBeenCalledTimes(1)

    buildWorktreeTerminalSnapshot({
      worktreeTerminalKey: descriptor.worktreeTerminalKey,
      selectedDescriptor: descriptor,
      pendingCreate: false,
      sessions: [session],
      selectedKey: descriptor.key,
      getCachedSnapshot: (key) => cache.get(key) ?? null,
      cacheSnapshot: (key, value) => cache.set(key, value),
      getDisplayOrder: () => 1,
      hasBell: () => false,
    })
    expect(session.snapshotSpy).toHaveBeenCalledTimes(1)
  })
})
