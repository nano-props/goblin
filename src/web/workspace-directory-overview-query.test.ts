import { QueryClient, QueryObserver } from '@tanstack/query-core'
import { describe, expect, test, vi } from 'vitest'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { getWorkspaceDirectoryOverview } from '#/web/workspace-client.ts'
import { workspaceDirectoryOverviewQueryOptions } from '#/web/workspace-directory-overview-query.ts'

vi.mock('#/web/workspace-client.ts', () => ({
  getWorkspaceDirectoryOverview: vi.fn(),
}))

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/directory-overview-workspace')

describe('workspace directory overview query', () => {
  test('shares its bounded HTTP read across a StrictMode-style observer replacement', async () => {
    const overview = Promise.withResolvers<WorkspaceDirectoryOverview>()
    vi.mocked(getWorkspaceDirectoryOverview).mockReturnValue(overview.promise)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const options = workspaceDirectoryOverviewQueryOptions(WORKSPACE_ID, 'workspace-runtime-1', true)
    const firstObserver = new QueryObserver(client, options)
    const unsubscribe = firstObserver.subscribe(() => {})

    await vi.waitFor(() => expect(getWorkspaceDirectoryOverview).toHaveBeenCalledOnce())
    unsubscribe()
    const replacementObserver = new QueryObserver(client, options)
    const unsubscribeReplacement = replacementObserver.subscribe(() => {})
    overview.resolve({
      topLevelFileCount: 1,
      topLevelDirectoryCount: 2,
      lastModifiedAt: '2023-11-14T22:13:20.000Z',
    })

    await vi.waitFor(() =>
      expect(replacementObserver.getCurrentResult().data?.lastModifiedAt).toBe('2023-11-14T22:13:20.000Z'),
    )
    expect(getWorkspaceDirectoryOverview).toHaveBeenCalledOnce()
    unsubscribeReplacement()
    client.clear()
  })
})
