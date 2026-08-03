import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  runGitWorkspaceMutationRuntimeRequest,
  runGitWorkspaceRuntimeRequest,
} from '#/server/modules/workspace-runtime-request.ts'
import { WorkspaceRuntimeAdmissionClosedError } from '#/server/modules/workspace-runtime-admission-error.ts'
import { RepoMembershipReadConflictError } from '#/server/modules/repo-membership-read-conflict.ts'
import { RepoMutationRuntimeFailureError } from '#/server/modules/repo-mutation-runtime-failure.ts'
import { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const settleRemoteWorkspaceRuntimeFailureMock = vi.hoisted(() => vi.fn())
vi.mock('#/server/modules/remote-workspace-runtime-failure-settlement.ts', () => ({
  settleRemoteWorkspaceRuntimeFailure: settleRemoteWorkspaceRuntimeFailureMock,
}))

describe('workspace runtime request', () => {
  beforeEach(() => {
    settleRemoteWorkspaceRuntimeFailureMock.mockReset()
    settleRemoteWorkspaceRuntimeFailureMock.mockResolvedValue(undefined)
  })
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

  test('preserves membership read conflicts as an actionable request result', async () => {
    await expect(
      runGitWorkspaceRuntimeRequest({
        userId: 'test-user',
        label: 'snapshot',
        run: async () => {
          throw new RepoMembershipReadConflictError()
        },
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'error.repo-membership-changing',
    })
  })

  test('settles runtime failure and returns the authoritative mutation result', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example.test/repo')
    const runtimeFailure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId,
      workspaceRuntimeId: 'runtime-mutation-failure',
      reason: 'unreachable',
      message: 'connection lost',
    })
    const error = new RepoMutationRuntimeFailureError(
      {
        ok: false,
        message: 'cancelled',
        recoveryMessageKeys: ['error.worktree-created-followup-failed'],
        repoIdsToInvalidate: [workspaceId],
      },
      runtimeFailure,
    )

    await expect(
      runGitWorkspaceMutationRuntimeRequest({
        userId: 'test-user',
        label: 'create-worktree',
        run: async () => {
          throw error
        },
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'cancelled',
      recoveryMessageKeys: ['error.worktree-created-followup-failed'],
    })
    expect(settleRemoteWorkspaceRuntimeFailureMock).toHaveBeenCalledWith('test-user', runtimeFailure)
  })

  test('preserves the mutation result when runtime lifecycle settlement fails', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example.test/repo')
    const runtimeFailure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId,
      workspaceRuntimeId: 'runtime-settlement-failure',
      reason: 'unreachable',
    })
    settleRemoteWorkspaceRuntimeFailureMock.mockRejectedValueOnce(new Error('settings unavailable'))

    await expect(
      runGitWorkspaceMutationRuntimeRequest({
        userId: 'test-user',
        label: 'create-worktree',
        run: async () => {
          throw new RepoMutationRuntimeFailureError(
            {
              ok: false,
              message: 'cancelled',
              recoveryMessageKeys: ['error.worktree-created-followup-failed'],
              repoIdsToInvalidate: [workspaceId],
            },
            runtimeFailure,
          )
        },
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'cancelled',
      recoveryMessageKeys: ['error.worktree-created-followup-failed'],
    })
  })
})
