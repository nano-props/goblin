// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'

const USER_ID = 'user_terminal_create_coordinator'
const SCOPE = 'repo-instance-terminal-create'
const WORKTREE_PATH = '/repo/worktree'
const OTHER_WORKTREE_PATH = '/repo/other-worktree'

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

  test('reuses an in-flight reservation for primary creates and releases it afterward', async () => {
    const sessionIds = ['term-reservedreserved00001', 'term-afterreleaseafterrel1']
    const coordinator = createTerminalSessionCreateCoordinator({
      manager: {
        listSessionsForUser: vi.fn(async () => []),
      },
      createSessionId: () => sessionIds.shift() ?? 'term-extraextraextraextra1',
    })

    let nestedPrimarySessionId: string | null = null
    const outerSessionId = await coordinator.withSessionIdAllocation(
      { userId: USER_ID, scope: SCOPE, worktreePath: WORKTREE_PATH, kind: 'additional' },
      async ({ terminalSessionId }) => {
        nestedPrimarySessionId = await coordinator.withSessionIdAllocation(
          { userId: USER_ID, scope: SCOPE, worktreePath: WORKTREE_PATH, kind: 'primary' },
          async (allocation) => allocation.terminalSessionId,
        )
        return terminalSessionId
      },
    )
    const afterReleaseSessionId = await coordinator.withSessionIdAllocation(
      { userId: USER_ID, scope: SCOPE, worktreePath: WORKTREE_PATH, kind: 'primary' },
      async ({ terminalSessionId }) => terminalSessionId,
    )

    expect(outerSessionId).toBe('term-reservedreserved00001')
    expect(nestedPrimarySessionId).toBe('term-reservedreserved00001')
    expect(afterReleaseSessionId).toBe('term-afterreleaseafterrel1')
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
    terminalSessionId,
    repoInstanceId: 'repo-instance-test',
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
