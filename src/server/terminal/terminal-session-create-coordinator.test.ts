// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const USER_ID = 'user_terminal_create_coordinator'
const SCOPE = 'repo-runtime-terminal-create'
const WORKTREE_PATH = '/repo/worktree'
const OTHER_WORKTREE_PATH = '/repo/other-worktree'
const WORKSPACE_ID = requiredWorkspaceLocator('goblin+file:///repo')
const WORKTREE_ROOT = requiredWorkspaceLocator('goblin+file:///repo/worktree')

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

describe('terminal session create coordinator', () => {
  test('reuses an existing worktree session for primary creates', async () => {
    const createSessionId = vi.fn(() => 'term-newnewnewnewnewnewnew')
    const coordinator = createTerminalSessionCreateCoordinator({
      manager: {
        listSessionsForUser: vi.fn(async () => [terminalSession('term-existingexisting00001')]),
      },
      createSessionId,
    })

    await expect(
      coordinator.withSessionIdAllocation(
        { userId: USER_ID, scope: SCOPE, worktreePath: WORKTREE_PATH, kind: 'primary' },
        async ({ terminalSessionId }) => terminalSessionId,
      ),
    ).resolves.toBe('term-existingexisting00001')
    expect(createSessionId).not.toHaveBeenCalled()
  })

  test('serializes creates for the same user scope and worktree', async () => {
    const coordinator = createTerminalSessionCreateCoordinator({
      manager: {
        listSessionsForUser: vi.fn(async () => []),
      },
      createSessionId: () => 'term-unusedunusedunused001',
    })
    const events: string[] = []
    let releaseFirstTask: () => void = () => {}
    const firstTaskCanFinish = new Promise<void>((resolve) => {
      releaseFirstTask = resolve
    })
    let markFirstTaskStarted: () => void = () => {}
    const firstTaskStarted = new Promise<void>((resolve) => {
      markFirstTaskStarted = resolve
    })
    const firstTask = coordinator.runInWorktreeQueue(
      { userId: USER_ID, scope: SCOPE, worktreePath: WORKTREE_PATH },
      async () => {
        events.push('first-start')
        markFirstTaskStarted()
        await firstTaskCanFinish
        events.push('first-end')
      },
    )

    await firstTaskStarted
    const secondTask = coordinator.runInWorktreeQueue(
      { userId: USER_ID, scope: SCOPE, worktreePath: WORKTREE_PATH },
      async () => {
        events.push('second-start')
      },
    )
    await Promise.resolve()
    expect(events).toEqual(['first-start'])

    releaseFirstTask()
    await firstTask
    await secondTask
    expect(events).toEqual(['first-start', 'first-end', 'second-start'])
  })

  test('allows creates for different worktrees to run independently', async () => {
    const coordinator = createTerminalSessionCreateCoordinator({
      manager: {
        listSessionsForUser: vi.fn(async () => []),
      },
      createSessionId: () => 'term-unusedunusedunused001',
    })
    const events: string[] = []
    let releaseFirstTask: () => void = () => {}
    const firstTaskCanFinish = new Promise<void>((resolve) => {
      releaseFirstTask = resolve
    })
    let markFirstTaskStarted: () => void = () => {}
    const firstTaskStarted = new Promise<void>((resolve) => {
      markFirstTaskStarted = resolve
    })
    const firstTask = coordinator.runInWorktreeQueue(
      { userId: USER_ID, scope: SCOPE, worktreePath: WORKTREE_PATH },
      async () => {
        events.push('first-start')
        markFirstTaskStarted()
        await firstTaskCanFinish
        events.push('first-end')
      },
    )

    await firstTaskStarted
    await coordinator.runInWorktreeQueue(
      { userId: USER_ID, scope: SCOPE, worktreePath: OTHER_WORKTREE_PATH },
      async () => {
        events.push('second-start')
      },
    )
    expect(events).toEqual(['first-start', 'second-start'])

    releaseFirstTask()
    await firstTask

    expect(events).toEqual(['first-start', 'second-start', 'first-end'])
  })
})

function terminalSession(terminalSessionId: string): TerminalSessionSummary {
  return {
    terminalRuntimeSessionId: `pty_${terminalSessionId}`,
    terminalRuntimeGeneration: 1,
    terminalSessionId,
    repoRuntimeId: 'repo-runtime-test',
    target: {
      kind: 'git-worktree',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      root: WORKTREE_ROOT,
    },
    repoRoot: '/repo',
    branch: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
    cwd: WORKTREE_PATH,
    controller: null,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    cols: 80,
    rows: 24,
  }
}
