// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { createTerminalSessionCreateCoordinator } from '#/server/terminal/terminal-session-create-coordinator.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const USER_ID = 'user_terminal_create_coordinator'
const SCOPE = 'repo-runtime-terminal-create'
const WORKTREE_ROOT = requiredWorkspaceLocator('goblin+file:///repo/worktree')

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

describe('terminal session create coordinator', () => {
  test('reuses an existing worktree session for primary creates', async () => {
    const primaryTerminalSessionIdForWorktree = vi.fn(() => 'term-existingexisting00001')
    const createSessionId = vi.fn(() => 'term-newnewnewnewnewnewnew')
    const coordinator = createTerminalSessionCreateCoordinator({
      manager: {
        primaryTerminalSessionIdForWorktree,
      },
      createSessionId,
    })

    await expect(
      coordinator.withSessionIdAllocation(
        { userId: USER_ID, scope: SCOPE, worktreeId: WORKTREE_ROOT, kind: 'primary' },
        async ({ terminalSessionId }) => terminalSessionId,
      ),
    ).resolves.toBe('term-existingexisting00001')
    expect(createSessionId).not.toHaveBeenCalled()
    expect(primaryTerminalSessionIdForWorktree).toHaveBeenCalledOnce()
    expect(primaryTerminalSessionIdForWorktree).toHaveBeenCalledWith(USER_ID, SCOPE, WORKTREE_ROOT)
  })

  test('allocates an additional durable id without consulting the primary index', async () => {
    const primaryTerminalSessionIdForWorktree = vi.fn(() => 'term-existingexisting00001')
    const coordinator = createTerminalSessionCreateCoordinator({
      manager: { primaryTerminalSessionIdForWorktree },
      createSessionId: () => 'term-additionaladditional01',
    })

    await expect(
      coordinator.withSessionIdAllocation(
        { userId: USER_ID, scope: SCOPE, worktreeId: WORKTREE_ROOT, kind: 'additional' },
        async ({ terminalSessionId }) => terminalSessionId,
      ),
    ).resolves.toBe('term-additionaladditional01')
    expect(primaryTerminalSessionIdForWorktree).not.toHaveBeenCalled()
  })

  test('serializes creates for the same user scope and worktree', async () => {
    const coordinator = createTerminalSessionCreateCoordinator({
      manager: {
        primaryTerminalSessionIdForWorktree: vi.fn(() => null),
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
      { userId: USER_ID, scope: SCOPE, worktreeId: WORKTREE_ROOT },
      async () => {
        events.push('first-start')
        markFirstTaskStarted()
        await firstTaskCanFinish
        events.push('first-end')
      },
    )

    await firstTaskStarted
    const secondTask = coordinator.runInWorktreeQueue(
      { userId: USER_ID, scope: SCOPE, worktreeId: WORKTREE_ROOT },
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
        primaryTerminalSessionIdForWorktree: vi.fn(() => null),
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
      { userId: USER_ID, scope: SCOPE, worktreeId: WORKTREE_ROOT },
      async () => {
        events.push('first-start')
        markFirstTaskStarted()
        await firstTaskCanFinish
        events.push('first-end')
      },
    )

    await firstTaskStarted
    await coordinator.runInWorktreeQueue(
      { userId: USER_ID, scope: SCOPE, worktreeId: requiredWorkspaceLocator('goblin+file:///repo/other-worktree') },
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
