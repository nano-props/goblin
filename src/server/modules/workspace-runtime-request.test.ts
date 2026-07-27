import { describe, expect, test } from 'vitest'
import { runGitWorkspaceRuntimeRequest } from '#/server/modules/workspace-runtime-request.ts'
import { WorkspaceRuntimeAdmissionClosedError } from '#/server/modules/workspace-runtime-admission-error.ts'

describe('workspace runtime request', () => {
  test('preserves authoritative runtime closure when the request signal is also aborted', async () => {
    const request = new AbortController()
    request.abort(new Error('client disconnected'))

    await expect(
      runGitWorkspaceRuntimeRequest({
        userId: 'test-user',
        label: 'remove-worktree',
        signal: request.signal,
        run: async () => {
          throw new WorkspaceRuntimeAdmissionClosedError()
        },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'error.workspace-runtime-stale',
    })
  })
})
