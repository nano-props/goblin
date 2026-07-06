// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalSessionPruner } from '#/server/terminal/terminal-session-pruner.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: vi.fn(async () => [
    { path: '/repo/live-worktree', branch: 'feature/live', isBare: false, isPrimary: false },
  ]),
}))

const USER_ID = 'user_terminal_pruner'
const SCOPE = 'repo-instance-terminal-pruner'
const REPO_ROOT = '/repo'
const LIVE_WORKTREE_PATH = '/repo/live-worktree'
const STALE_WORKTREE_PATH = '/repo/stale-worktree'
const REMOTE_REPO_ROOT = 'ssh-config://prod/srv/repo'

describe('terminal session pruner', () => {
  beforeEach(() => {
    vi.mocked(getWorktrees).mockResolvedValue([
      { path: LIVE_WORKTREE_PATH, branch: 'feature/live', isBare: false, isPrimary: false },
    ])
  })

  test('closes local sessions whose worktree is no longer live', async () => {
    const sessions = [
      terminalSession('session-live', { repoRoot: REPO_ROOT, worktreePath: LIVE_WORKTREE_PATH }),
      terminalSession('session-stale', { repoRoot: REPO_ROOT, worktreePath: STALE_WORKTREE_PATH }),
      terminalSession('session-other-repo', { repoRoot: '/other-repo', worktreePath: '/other-repo/worktree' }),
    ]
    const closeSession = vi.fn((terminalRuntimeSessionId: string) => {
      const index = sessions.findIndex((session) => session.terminalRuntimeSessionId === terminalRuntimeSessionId)
      if (index !== -1) sessions.splice(index, 1)
    })
    const pruner = createTerminalSessionPruner({
      manager: {
        listSessionsForUser: vi.fn(async () => [...sessions]),
        closeSession,
      },
    })

    await expect(
      pruner.prune({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        assertCurrent: vi.fn(),
      }),
    ).resolves.toEqual({ pruned: 1, remaining: 2 })
    expect(getWorktrees).toHaveBeenCalledWith(REPO_ROOT, { includeStatus: false })
    expect(closeSession).toHaveBeenCalledTimes(1)
    expect(closeSession).toHaveBeenCalledWith('pty_session-stale')
  })

  test('does not close remote sessions', async () => {
    const sessions = [
      terminalSession('session-remote-a', { repoRoot: REMOTE_REPO_ROOT, worktreePath: '/srv/repo' }),
      terminalSession('session-remote-b', { repoRoot: REMOTE_REPO_ROOT, worktreePath: '/srv/repo/linked' }),
    ]
    const closeSession = vi.fn()
    const assertCurrent = vi.fn()
    const pruner = createTerminalSessionPruner({
      manager: {
        listSessionsForUser: vi.fn(async () => sessions),
        closeSession,
      },
    })

    await expect(
      pruner.prune({
        userId: USER_ID,
        repoRoot: REMOTE_REPO_ROOT,
        scope: SCOPE,
        assertCurrent,
      }),
    ).resolves.toEqual({ pruned: 0, remaining: 2 })
    expect(getWorktrees).not.toHaveBeenCalled()
    expect(assertCurrent).not.toHaveBeenCalled()
    expect(closeSession).not.toHaveBeenCalled()
  })

  test('checks repo instance freshness after reading local worktrees and before closing sessions', async () => {
    const closeSession = vi.fn()
    const assertCurrent = vi.fn(() => {
      throw new Error('error.repo-instance-stale')
    })
    const pruner = createTerminalSessionPruner({
      manager: {
        listSessionsForUser: vi.fn(async () => [
          terminalSession('session-stale', { repoRoot: REPO_ROOT, worktreePath: STALE_WORKTREE_PATH }),
        ]),
        closeSession,
      },
    })

    await expect(
      pruner.prune({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        assertCurrent,
      }),
    ).rejects.toThrow('error.repo-instance-stale')
    expect(getWorktrees).toHaveBeenCalledWith(REPO_ROOT, { includeStatus: false })
    expect(assertCurrent).toHaveBeenCalledTimes(1)
    expect(closeSession).not.toHaveBeenCalled()
  })
})

function terminalSession(
  terminalSessionId: string,
  overrides: Partial<Pick<TerminalSessionSummary, 'repoRoot' | 'worktreePath'>> = {},
): TerminalSessionSummary {
  return {
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    terminalSessionId,
    repoInstanceId: 'repo-instance-test',
    repoRoot: overrides.repoRoot ?? REPO_ROOT,
    branch: 'feature/worktree',
    worktreePath: overrides.worktreePath ?? LIVE_WORKTREE_PATH,
    cwd: overrides.worktreePath ?? LIVE_WORKTREE_PATH,
    controller: null,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    cols: 80,
    rows: 24,
  }
}
