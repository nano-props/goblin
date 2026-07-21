import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({ resolveRepoWriteBoundaryKey: vi.fn() }))

vi.mock('#/server/modules/repo-source.ts', () => ({
  captureRepoWriteExecution: async (repoId: typeof REMOTE_REPO) => {
    const key = await mocks.resolveRepoWriteBoundaryKey(repoId)
    return { coordinationKey: key, repositoryKey: key }
  },
  repoWriteExecutionBoundaryKey: (capability: { repositoryKey: string }) => capability.repositoryKey,
  repoWriteExecutionCoordinationKey: (capability: { coordinationKey: string }) => capability.coordinationKey,
  resolveRepoWriteBoundaryIdentity: async (repoId: typeof REMOTE_REPO) => {
    const key = await mocks.resolveRepoWriteBoundaryKey(repoId)
    return { coordinationKey: key, repositoryKey: key }
  },
  runWithCapturedRepoWriteExecution: async (
    _capability: unknown,
    task: (source: object) => Promise<unknown>,
  ) => await task({}),
  validateRepoWriteExecution: async () => true,
}))

const REMOTE_REPO = workspaceIdForTest('goblin+ssh://example/repo')
const OTHER_REPO = workspaceIdForTest('goblin+ssh://example/other')

async function recordSuccessfulFetch(repoId: typeof REMOTE_REPO): Promise<void> {
  const { enqueueRepoWriteOperation } = await import('#/server/modules/repo-write-operation-coordinator.ts')
  await enqueueRepoWriteOperation(
    repoId,
    undefined,
    { repoId, kind: 'fetch', source: 'background' },
    (operation, context) => async () => {
      operation.start()
      operation.settle({ ok: true })
      return { ok: true, message: 'fetched' }
    },
  )
}

describe('repo write boundary groups', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { resetRepoWriteOperationCoordinatorForTests } =
      await import('#/server/modules/repo-write-operation-coordinator.ts')
    resetRepoWriteOperationCoordinatorForTests()
  })

  test('does not create a boundary group when canonical resolution fails', async () => {
    const registry = await import('#/server/modules/repo-write-operation-coordinator.ts')
    mocks.resolveRepoWriteBoundaryKey.mockRejectedValue(new Error('error.repository-boundary-unavailable'))

    await expect(registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)).rejects.toThrow(
      'error.repository-boundary-unavailable',
    )
    expect(registry.repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 0,
      registeredBoundaries: 0,
    })
  })

  test('keeps metadata on the confirmed canonical boundary', async () => {
    const registry = await import('#/server/modules/repo-write-operation-coordinator.ts')
    const resolvedKey = 'remote-git:goblin+ssh://host/repo'
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValue(resolvedKey)

    const boundary = await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)
    await recordSuccessfulFetch(REMOTE_REPO)

    expect(await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)).toBe(boundary)
    expect(registry.getRepoBoundaryLastFetchAt(boundary)).toEqual(expect.any(Number))
  })

  test('keeps distinct repository boundaries isolated', async () => {
    const registry = await import('#/server/modules/repo-write-operation-coordinator.ts')
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (repoId) =>
      repoId === REMOTE_REPO
        ? 'remote-git:goblin+ssh://host/repo'
        : 'remote-git:goblin+ssh://host/other',
    )

    const firstKey = await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)
    const secondKey = await registry.resolveRepoWriteBoundaryForRead(OTHER_REPO)
    await recordSuccessfulFetch(REMOTE_REPO)

    expect(registry.getRepoBoundaryLastFetchAt(firstKey)).toEqual(expect.any(Number))
    expect(registry.getRepoBoundaryLastFetchAt(secondKey)).toBeNull()
  })
})
