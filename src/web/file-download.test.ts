// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

vi.mock('#/web/lib/server-config.ts', () => ({
  requireClientServerConfig: () => ({ url: 'http://example.test:32100/', accessToken: '' }),
}))

import { downloadWorkspaceFile } from '#/web/file-download.ts'

afterEach(() => vi.restoreAllMocks())

describe('workspace file download URL', () => {
  test('opens a browser download URL in a new tab with scalar target parameters', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const workspaceId = workspaceIdForTest('goblin+file:///repo')

    downloadWorkspaceFile(
      { kind: 'git-worktree', workspaceId, workspaceRuntimeId: 'workspace-runtime-test', root: workspaceId },
      'docs/report final.pdf',
    )

    expect(open).toHaveBeenCalledOnce()
    const [href, target] = open.mock.calls[0] ?? []
    if (typeof href !== 'string') throw new Error('Expected download URL')
    const url = new URL(href)
    expect(url.pathname).toBe('/api/workspace/download-file')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: 'git-worktree',
      workspaceId,
      workspaceRuntimeId: 'workspace-runtime-test',
      root: workspaceId,
      path: 'docs/report final.pdf',
    })
    expect(target).toBe('_blank')
  })
})
