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
})
