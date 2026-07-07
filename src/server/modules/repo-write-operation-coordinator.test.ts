import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  enqueueRepoWriteOperation,
  listRepoWriteOperationsForRepo,
  resetRepoWriteOperationCoordinatorForTests,
} from '#/server/modules/repo-write-operation-coordinator.ts'

const mocks = vi.hoisted(() => ({
  resolveRepoWriteBoundaryKey: vi.fn(async (repoId: string) => repoId),
}))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRepoWriteBoundaryKey: mocks.resolveRepoWriteBoundaryKey,
}))

beforeEach(() => {
  resetRepoWriteOperationCoordinatorForTests()
  mocks.resolveRepoWriteBoundaryKey.mockReset()
  mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (repoId: string) => repoId)
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('repo write operation coordinator', () => {
  test('settles operations when the queued task throws', async () => {
    await expect(
      enqueueRepoWriteOperation(
        '/tmp/repo',
        undefined,
        { repoId: '/tmp/repo', kind: 'delete-branch', source: 'user' },
        (operation) => async () => {
          operation.start()
          throw new Error('boom')
        },
      ),
    ).rejects.toThrow('boom')

    await expect(listRepoWriteOperationsForRepo('/tmp/repo', { includeSettled: true })).resolves.toMatchObject([
      {
        repoId: '/tmp/repo',
        kind: 'delete-branch',
        phase: 'failed',
        error: { message: 'boom' },
      },
    ])
  })

  test('keeps settled write operations globally bounded', async () => {
    for (let index = 0; index < 105; index += 1) {
      const repoId = `/tmp/repo-${index}`
      vi.setSystemTime(1_000 + index)
      await enqueueRepoWriteOperation(
        repoId,
        undefined,
        { repoId, kind: 'fetch', source: 'background' },
        (operation) => async () => {
          operation.start()
          operation.settle({ ok: true, message: 'ok' })
          return { ok: true, message: 'ok' }
        },
      )
    }

    await expect(listRepoWriteOperationsForRepo(undefined, { includeSettled: true })).resolves.toHaveLength(100)
    await expect(listRepoWriteOperationsForRepo('/tmp/repo-0', { includeSettled: true })).resolves.toEqual([])
    await expect(listRepoWriteOperationsForRepo('/tmp/repo-104', { includeSettled: true })).resolves.toMatchObject([
      { repoId: '/tmp/repo-104', kind: 'fetch', phase: 'done' },
    ])
  })
})
