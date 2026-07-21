import { describe, expect, test } from 'vitest'
import { runGitWorkspaceRuntimeRequest } from '#/server/modules/workspace-runtime-request.ts'
import { WorkspaceRuntimeAdmissionClosedError } from '#/server/modules/workspace-runtime-admission-error.ts'
import { RepositoryTargetChangedError } from '#/server/modules/repository-target-changed-error.ts'

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

  test('maps an initial repository target mismatch to a bad request', async () => {
    await expect(
      runGitWorkspaceRuntimeRequest({
        userId: 'test-user',
        label: 'remove-worktree',
        run: async () => {
          throw new RepositoryTargetChangedError()
        },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'error.repository-target-changed',
    })
  })
})
