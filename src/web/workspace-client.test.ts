// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { getLocalDirectoryPathSuggestions } from '#/web/workspace-client.ts'

const mocks = vi.hoisted(() => ({ postServerJson: vi.fn() }))

vi.mock('#/web/lib/server-fetch.ts', () => ({ postServerJson: mocks.postServerJson }))

describe('workspace client', () => {
  beforeEach(() => mocks.postServerJson.mockReset())

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
})
