import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginRepoServerOperation,
  listRepoServerOperations,
  resetRepoServerOperationRegistryForTests,
  settleRepoServerOperation,
  startRepoServerOperation,
} from '#/server/modules/repo-operation-registry.ts'

beforeEach(() => {
  resetRepoServerOperationRegistryForTests()
  vi.useFakeTimers()
})

afterEach(() => {
  resetRepoServerOperationRegistryForTests()
  vi.useRealTimers()
})

describe('repo operation registry', () => {
  test('orders settled operations by settledAt', () => {
    vi.setSystemTime(100)
    const first = beginRepoServerOperation({ repoId: '/tmp/repo', kind: 'delete-branch', source: 'user' })
    startRepoServerOperation(first.id)

    vi.setSystemTime(200)
    const second = beginRepoServerOperation({ repoId: '/tmp/repo', kind: 'remove-worktree', source: 'user' })
    startRepoServerOperation(second.id)

    vi.setSystemTime(250)
    settleRepoServerOperation(second.id, { ok: true, message: 'second done' })

    vi.setSystemTime(300)
    settleRepoServerOperation(first.id, { ok: true, message: 'first done' })

    expect(
      listRepoServerOperations({ repoId: '/tmp/repo', includeSettled: true }).map((operation) => operation.id),
    ).toEqual([first.id, second.id])
  })

  test('filters runtime-scoped operations while retaining repo-scoped operations', () => {
    const repoScoped = beginRepoServerOperation({ repoId: '/tmp/repo', kind: 'fetch', source: 'background' })
    const current = beginRepoServerOperation({
      repoId: '/tmp/repo',
      workspaceRuntimeId: 'repo-runtime-current',
      kind: 'delete-branch',
      source: 'user',
    })
    beginRepoServerOperation({
      repoId: '/tmp/repo',
      workspaceRuntimeId: 'repo-runtime-stale',
      kind: 'remove-worktree',
      source: 'user',
    })

    expect(
      listRepoServerOperations({ repoId: '/tmp/repo', workspaceRuntimeId: 'repo-runtime-current' }).map(
        (operation) => operation.id,
      ),
    ).toEqual([repoScoped.id, current.id])
  })
})
