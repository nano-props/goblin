// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTerminalSessionPruner } from '#/server/terminal/terminal-session-pruner.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

vi.mock('#/system/git/worktrees.ts', () => ({
  getWorktrees: vi.fn(async () => [
    { path: '/repo/live-worktree', branch: 'feature/live', isBare: false, isPrimary: false },
  ]),
}))

const USER_ID = 'user_terminal_pruner'
const SCOPE = 'repo-runtime-terminal-pruner'
const REPO_ROOT = workspaceIdForTest('goblin+file:///repo')
const LIVE_WORKTREE_PATH = '/repo/live-worktree'
const STALE_WORKTREE_PATH = '/repo/stale-worktree'
const REMOTE_REPO_ROOT = workspaceIdForTest('goblin+ssh://prod/srv/repo')

describe('terminal session pruner', () => {
  beforeEach(() => {
    vi.mocked(getWorktrees).mockResolvedValue([
      { path: LIVE_WORKTREE_PATH, branch: 'feature/live', isBare: false, isPrimary: false },
    ])
  })

  test('closes local sessions whose worktree is no longer live', async () => {
    const sessions = [
      terminalSession('term-livelivelivelivelive1', { repoRoot: REPO_ROOT, worktreePath: LIVE_WORKTREE_PATH }),
      terminalSession('term-stalestalestalestale1', { repoRoot: REPO_ROOT, worktreePath: STALE_WORKTREE_PATH }),
      terminalSession('term-otherrepootherrepo001', {
        repoRoot: 'goblin+file:///other-repo',
        worktreePath: '/other-repo/worktree',
      }),
    ]
    const closeSession = vi.fn(async (terminalRuntimeSessionId: string) => {
      const index = sessions.findIndex((session) => session.terminalRuntimeSessionId === terminalRuntimeSessionId)
      if (index !== -1) sessions.splice(index, 1)
      return index !== -1
    })
    const pruner = createTerminalSessionPruner({
      manager: {
        listSessionsForUser: vi.fn(async () => [...sessions]),
        requestSessionRetirement: closeSession,
      },
    })

    await expect(
      pruner.prune({
        userId: USER_ID,
        workspaceId: REPO_ROOT,
        scope: SCOPE,
        assertCurrent: vi.fn(),
      }),
    ).resolves.toEqual({ pruned: 1, remaining: 2 })
    expect(getWorktrees).toHaveBeenCalledWith('/repo', { includeStatus: false })
    expect(closeSession).toHaveBeenCalledTimes(1)
    expect(closeSession).toHaveBeenCalledWith('pty_term-stalestalestalestale1')
  })

  test('does not close remote sessions', async () => {
    const sessions = [
      terminalSession('term-remotearemotearemotea', { repoRoot: REMOTE_REPO_ROOT, worktreePath: '/srv/repo' }),
      terminalSession('term-remotebremotebremoteb', { repoRoot: REMOTE_REPO_ROOT, worktreePath: '/srv/repo/linked' }),
    ]
    const closeSession = vi.fn(async () => false)
    const assertCurrent = vi.fn()
    const pruner = createTerminalSessionPruner({
      manager: {
        listSessionsForUser: vi.fn(async () => sessions),
        requestSessionRetirement: closeSession,
      },
    })

    await expect(
      pruner.prune({
        userId: USER_ID,
        workspaceId: REMOTE_REPO_ROOT,
        scope: SCOPE,
        assertCurrent,
      }),
    ).resolves.toEqual({ pruned: 0, remaining: 2 })
    expect(getWorktrees).not.toHaveBeenCalled()
    expect(assertCurrent).not.toHaveBeenCalled()
    expect(closeSession).not.toHaveBeenCalled()
  })

  test('checks workspace runtime freshness after reading local worktrees and before closing sessions', async () => {
    const closeSession = vi.fn()
    const assertCurrent = vi.fn(() => {
      throw new Error('error.workspace-runtime-stale')
    })
    const pruner = createTerminalSessionPruner({
      manager: {
        listSessionsForUser: vi.fn(async () => [
          terminalSession('term-stalestalestalestale1', { repoRoot: REPO_ROOT, worktreePath: STALE_WORKTREE_PATH }),
        ]),
        requestSessionRetirement: closeSession,
      },
    })

    await expect(
      pruner.prune({
        userId: USER_ID,
        workspaceId: REPO_ROOT,
        scope: SCOPE,
        assertCurrent,
      }),
    ).rejects.toThrow('error.workspace-runtime-stale')
    expect(getWorktrees).toHaveBeenCalledWith('/repo', { includeStatus: false })
    expect(assertCurrent).toHaveBeenCalledTimes(1)
    expect(closeSession).not.toHaveBeenCalled()
  })
})

function terminalSession(
  terminalSessionId: string,
  overrides: { repoRoot?: string; worktreePath?: string } = {},
): TerminalSessionSummary {
  const repoRoot = overrides.repoRoot ?? REPO_ROOT
  const worktreePath = overrides.worktreePath ?? LIVE_WORKTREE_PATH
  const workspaceId = requiredWorkspaceLocator(repoRoot)
  const root = requiredWorkspaceLocator(
    repoRoot.startsWith('goblin+ssh://')
      ? `${repoRoot.slice(0, repoRoot.indexOf('/', 'goblin+ssh://'.length))}${worktreePath}`
      : `goblin+file://${worktreePath}`,
  )
  return {
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    terminalRuntimeGeneration: 1,
    terminalSessionId,
    target: { kind: 'git-worktree', workspaceId, workspaceRuntimeId: 'repo-runtime-test', root },
    presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'feature/worktree' } },
    controller: null,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    cols: 80,
    rows: 24,
  }
}

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}
