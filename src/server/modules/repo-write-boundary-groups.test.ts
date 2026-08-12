import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { repoRuntimeCapabilityForTest } from '#/server/test-utils/repo-module.ts'

const mocks = vi.hoisted(() => ({ resolveRepoWriteBoundaryKey: vi.fn() }))

vi.mock('#/server/modules/repo-source.ts', () => ({
  captureRepoWriteExecution: async (repoId: typeof REMOTE_REPO) => {
    const key = await mocks.resolveRepoWriteBoundaryKey(repoId)
    return { boundaryKey: key }
  },
  repoWriteExecutionBoundaryKey: (capability: { boundaryKey: string }) => capability.boundaryKey,
  runWithCapturedRepoWriteExecution: async (_capability: unknown, task: (source: object) => Promise<unknown>) =>
    await task({}),
}))

vi.mock('#/server/modules/repo-write-boundary.ts', () => ({
  resolveRepoWriteBoundaryKey: mocks.resolveRepoWriteBoundaryKey,
}))

const REMOTE_REPO = workspaceIdForTest('goblin+ssh://example/repo')
const OTHER_REPO = workspaceIdForTest('goblin+ssh://example/other')

async function recordSuccessfulFetch(repoId: typeof REMOTE_REPO): Promise<void> {
  const { enqueueRepoWriteOperation } = await import('#/server/modules/repo-write-operation-coordinator.ts')
  await enqueueRepoWriteOperation(
    repoId,
    undefined,
    {
      runtimeCapability: repoRuntimeCapabilityForTest(repoId, 'test-runtime'),
      repoId,
      kind: 'fetch',
      source: 'background',
    },
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
    expect(registry.getRepoLastSuccessfulFetchAt(REMOTE_REPO)).toEqual(expect.any(Number))
  })

  test('keeps distinct repository boundaries isolated', async () => {
    const registry = await import('#/server/modules/repo-write-operation-coordinator.ts')
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (repoId) =>
      repoId === REMOTE_REPO ? 'remote-git:goblin+ssh://host/repo' : 'remote-git:goblin+ssh://host/other',
    )

    await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)
    await registry.resolveRepoWriteBoundaryForRead(OTHER_REPO)
    await recordSuccessfulFetch(REMOTE_REPO)

    expect(registry.getRepoLastSuccessfulFetchAt(REMOTE_REPO)).toEqual(expect.any(Number))
    expect(registry.getRepoLastSuccessfulFetchAt(OTHER_REPO)).toBeNull()
  })

  test('does not carry fetch metadata across a physical boundary rebind', async () => {
    const registry = await import('#/server/modules/repo-write-operation-coordinator.ts')
    let boundaryKey = 'remote-git:goblin+ssh://host/repo-a'
    mocks.resolveRepoWriteBoundaryKey.mockImplementation(async () => boundaryKey)
    await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)
    await recordSuccessfulFetch(REMOTE_REPO)
    expect(registry.getRepoLastSuccessfulFetchAt(REMOTE_REPO)).toEqual(expect.any(Number))

    boundaryKey = 'remote-git:goblin+ssh://host/repo-b'
    await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)

    expect(registry.getRepoLastSuccessfulFetchAt(REMOTE_REPO)).toBeNull()
  })
})
