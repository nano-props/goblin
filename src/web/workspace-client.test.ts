// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getLocalDirectoryPathSuggestions, refreshWorkspace } from '#/web/workspace-client.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({ postServerCommandJson: vi.fn(), postServerJson: vi.fn() }))

vi.mock('#/web/lib/server-fetch.ts', () => ({
  postServerCommandJson: mocks.postServerCommandJson,
  postServerJson: mocks.postServerJson,
}))

describe('workspace client', () => {
  beforeEach(() => {
    mocks.postServerCommandJson.mockReset()
    mocks.postServerJson.mockReset()
  })

  test('reads local suggestions through the authenticated HTTP POST boundary', async () => {
    const signal = new AbortController().signal
    mocks.postServerJson.mockResolvedValue(['/srv/repo'])

    await expect(getLocalDirectoryPathSuggestions('/srv/re', signal)).resolves.toEqual(['/srv/repo'])
    expect(mocks.postServerJson).toHaveBeenCalledWith(
      '/api/workspace/path-suggestions',
      { prefix: '/srv/re' },
      expect.any(Function),
      { signal },
    )
  })

  test('runs workspace refresh through the command outcome boundary', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///repo')
    const response = { ok: true }
    mocks.postServerCommandJson.mockResolvedValue(response)

    await expect(refreshWorkspace(workspaceId, 'workspace-runtime-test')).resolves.toBe(response)
    expect(mocks.postServerCommandJson).toHaveBeenCalledWith(
      '/api/workspace/refresh',
      { workspaceId, workspaceRuntimeId: 'workspace-runtime-test' },
      expect.any(Function),
      { signal: undefined },
    )
  })
})
