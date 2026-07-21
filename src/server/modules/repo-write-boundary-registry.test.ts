import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({ resolveRepoWriteBoundaryKey: vi.fn() }))

vi.mock('#/server/modules/repo-source.ts', () => ({
  resolveRepoWriteBoundaryKey: mocks.resolveRepoWriteBoundaryKey,
}))

const REMOTE_REPO = workspaceIdForTest('goblin+ssh://example/repo')
const OTHER_REPO = workspaceIdForTest('goblin+ssh://example/other')

describe('repo write boundary registry', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { resetRepoWriteBoundaryRegistryForTests } =
      await import('#/server/modules/repo-write-boundary-registry.ts')
    resetRepoWriteBoundaryRegistryForTests()
  })

  test('preserves fetch metadata when a remote fallback is rebound to a resolved boundary', async () => {
    const registry = await import('#/server/modules/repo-write-boundary-registry.ts')
    const fallbackKey = `remote-git:${REMOTE_REPO}`
    const resolvedKey = 'remote-git:goblin+ssh://host/repo'
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValueOnce(fallbackKey).mockResolvedValueOnce(resolvedKey)

    const admittedKey = await registry.resolveRepoWriteBoundary(REMOTE_REPO)
    registry.recordRepoBoundaryFetchSuccess(admittedKey)
    const recordedAt = registry.getRepoBoundaryLastFetchAt(admittedKey)

    expect(await registry.resolveRepoWriteBoundary(REMOTE_REPO)).toBe(resolvedKey)
    expect(registry.getRepoBoundaryLastFetchAt(resolvedKey)).toBe(recordedAt)
    expect(registry.getRepoBoundaryLastFetchAt(fallbackKey)).toBe(recordedAt)
  })

  test('does not downgrade a resolved binding after a transient fallback', async () => {
    const registry = await import('#/server/modules/repo-write-boundary-registry.ts')
    const resolvedKey = 'remote-git:goblin+ssh://host/repo'
    const fallbackKey = `remote-git:${REMOTE_REPO}`
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValueOnce(resolvedKey).mockResolvedValueOnce(fallbackKey)

    expect(await registry.resolveRepoWriteBoundary(REMOTE_REPO)).toBe(resolvedKey)
    expect(await registry.resolveRepoWriteBoundary(REMOTE_REPO)).toBe(resolvedKey)
  })

  test('redirects a late success captured before fallback rebind', async () => {
    const registry = await import('#/server/modules/repo-write-boundary-registry.ts')
    const fallbackKey = `remote-git:${REMOTE_REPO}`
    const resolvedKey = 'remote-git:goblin+ssh://host/repo'
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValueOnce(fallbackKey).mockResolvedValueOnce(resolvedKey)

    const capturedKey = await registry.resolveRepoWriteBoundary(REMOTE_REPO)
    expect(await registry.resolveRepoWriteBoundary(REMOTE_REPO)).toBe(resolvedKey)
    registry.recordRepoBoundaryFetchSuccess(capturedKey)

    expect(registry.getRepoBoundaryLastFetchAt(resolvedKey)).toEqual(expect.any(Number))
    expect(registry.getRepoBoundaryLastFetchAt(fallbackKey)).toBe(registry.getRepoBoundaryLastFetchAt(resolvedKey))
  })

  test('keeps distinct repository boundaries isolated', async () => {
    const registry = await import('#/server/modules/repo-write-boundary-registry.ts')
    mocks.resolveRepoWriteBoundaryKey
      .mockResolvedValueOnce('remote-git:goblin+ssh://host/repo')
      .mockResolvedValueOnce('remote-git:goblin+ssh://host/other')

    const firstKey = await registry.resolveRepoWriteBoundary(REMOTE_REPO)
    const secondKey = await registry.resolveRepoWriteBoundary(OTHER_REPO)
    registry.recordRepoBoundaryFetchSuccess(firstKey)

    expect(registry.getRepoBoundaryLastFetchAt(firstKey)).toEqual(expect.any(Number))
    expect(registry.getRepoBoundaryLastFetchAt(secondKey)).toBeNull()
  })
})
