import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  repoWriteOperationCoordinatorStatsForTests,
  resetRepoWriteOperationCoordinatorForTests,
  resolveRepoWriteBoundaryForRead,
} from '#/server/modules/repo-write-operation-coordinator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const LINKED_WORKSPACE_BOUNDARY_KEY = '/workspace-linked/.git'

const mocks = vi.hoisted(() => ({
  resolveRepoWriteBoundaryKey: vi.fn(
    async (workspaceId: WorkspaceId, _signal?: AbortSignal): Promise<string> => workspaceId,
  ),
  workspaceRuntimeClosed: null as
    ((event: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string }) => void) | null,
}))

vi.mock('#/server/modules/repo-write-boundary.ts', () => ({
  resolveRepoWriteBoundaryKey: mocks.resolveRepoWriteBoundaryKey,
}))

vi.mock('#/server/modules/workspace-runtimes.ts', () => ({
  onWorkspaceRuntimeClosed: (
    listener: (event: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string }) => void,
  ) => {
    mocks.workspaceRuntimeClosed = listener
    return () => {
      if (mocks.workspaceRuntimeClosed === listener) mocks.workspaceRuntimeClosed = null
    }
  },
  onWorkspaceRuntimeFailed: () => () => {},
}))

beforeEach(() => {
  resetRepoWriteOperationCoordinatorForTests()
  mocks.resolveRepoWriteBoundaryKey.mockReset()
  mocks.resolveRepoWriteBoundaryKey.mockImplementation(async (workspaceId) => workspaceId)
  mocks.workspaceRuntimeClosed = null
})

describe('repo write operation coordinator lifecycle', () => {
  test('reclaims an idle boundary group after its workspace runtime closes', async () => {
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-a' })
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 1,
      registeredBoundaries: 1,
      registeredRepoIds: 1,
    })

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })

    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 0,
      registeredBoundaries: 0,
      registeredRepoIds: 0,
    })
  })

  test('keeps a boundary registered until its final workspace runtime closes', async () => {
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-a' })
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID, { workspaceRuntimeId: 'runtime-b' })

    mocks.workspaceRuntimeClosed?.({ userId: 'user-a', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' })
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 1,
      registeredRepoIds: 1,
    })

    mocks.workspaceRuntimeClosed?.({ userId: 'user-b', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-b' })
    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 0,
      registeredRepoIds: 0,
    })
  })

  test('reclaims an idle descriptor when a repo resolves to a new boundary', async () => {
    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)
    mocks.resolveRepoWriteBoundaryKey.mockResolvedValue(LINKED_WORKSPACE_BOUNDARY_KEY)

    await resolveRepoWriteBoundaryForRead(WORKSPACE_ID)

    expect(repoWriteOperationCoordinatorStatsForTests()).toMatchObject({
      boundaryRuntimes: 1,
      registeredBoundaries: 1,
      registeredRepoIds: 1,
    })
  })
})
