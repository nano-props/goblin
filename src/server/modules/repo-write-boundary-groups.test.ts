import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({ resolveRepoWriteBoundaryKey: vi.fn() }))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRepoWriteBoundaryKey: mocks.resolveRepoWriteBoundaryKey,
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
      context.recordFetchSuccess()
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

  test('preserves fetch metadata when a remote fallback is rebound to a resolved boundary', async () => {
    const registry = await import('#/server/modules/repo-write-operation-coordinator.ts')
    const fallbackKey = `remote-git:${REMOTE_REPO}`
    const resolvedKey = 'remote-git:goblin+ssh://host/repo'
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValueOnce(fallbackKey).mockResolvedValue(resolvedKey)

    const admittedKey = await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)
    await recordSuccessfulFetch(REMOTE_REPO)
    const recordedAt = registry.getRepoBoundaryLastFetchAt(admittedKey)

    expect(await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)).toBe(admittedKey)
    expect(registry.getRepoBoundaryLastFetchAt(admittedKey)).toBe(recordedAt)
  })

  test('does not downgrade a resolved binding after a transient fallback', async () => {
    const registry = await import('#/server/modules/repo-write-operation-coordinator.ts')
    const resolvedKey = 'remote-git:goblin+ssh://host/repo'
    const fallbackKey = `remote-git:${REMOTE_REPO}`
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValueOnce(resolvedKey).mockResolvedValueOnce(fallbackKey)

    const initial = await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)
    expect(await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)).toBe(initial)
  })

  test('redirects a late success captured before fallback rebind', async () => {
    const registry = await import('#/server/modules/repo-write-operation-coordinator.ts')
    const fallbackKey = `remote-git:${REMOTE_REPO}`
    const resolvedKey = 'remote-git:goblin+ssh://host/repo'
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValueOnce(fallbackKey).mockResolvedValue(resolvedKey)

    const capturedKey = await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)
    expect(await registry.resolveRepoWriteBoundaryForRead(REMOTE_REPO)).toBe(capturedKey)
    await recordSuccessfulFetch(REMOTE_REPO)

    expect(registry.getRepoBoundaryLastFetchAt(capturedKey)).toEqual(expect.any(Number))
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
