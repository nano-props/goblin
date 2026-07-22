// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { repoProjectionQueryOptions } from '#/web/repo-query-options.ts'
import { getRepoProjectionFetchInvalidationVersion } from '#/web/repo-query-runtime.ts'
import { useRepoProjectionQueryEffects } from '#/web/repo-projection-query-effects.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const WORKSPACE_RUNTIME_ID = 'workspace-runtime-query-effects'

function Harness({ queryClient }: { queryClient: QueryClient }) {
  useRepoProjectionQueryEffects(queryClient)
  return null
}

test('clears projection fetch bookkeeping when its query is removed', async () => {
  const queryClient = new QueryClient()
  installGoblinTestBridge({
    'repo.projection': async () => ({
      snapshot: { branches: [], current: '' },
      pullRequests: null,
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 1,
    }),
  })
  renderInJsdom(<Harness queryClient={queryClient} />)
  const options = repoProjectionQueryOptions(WORKSPACE_ID, WORKSPACE_RUNTIME_ID, null, 'full')

  await queryClient.fetchQuery(options)
  expect(getRepoProjectionFetchInvalidationVersion(WORKSPACE_ID, WORKSPACE_RUNTIME_ID, null, 'full', queryClient)).toBe(
    0,
  )

  queryClient.removeQueries({ queryKey: options.queryKey, exact: true })

  expect(
    getRepoProjectionFetchInvalidationVersion(WORKSPACE_ID, WORKSPACE_RUNTIME_ID, null, 'full', queryClient),
  ).toBeNull()
})
