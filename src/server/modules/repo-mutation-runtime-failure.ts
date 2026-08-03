import type { RepoMutationResult } from '#/server/modules/repo-mutation-impact.ts'
import type { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'

/**
 * Carries an established domain mutation result to its application owner before the
 * original runtime failure continues through normal lifecycle settlement.
 */
export class RepoMutationRuntimeFailureError extends Error {
  readonly mutation: RepoMutationResult
  readonly runtimeFailure: RemoteWorkspaceRuntimeFailureError

  constructor(mutation: RepoMutationResult, runtimeFailure: RemoteWorkspaceRuntimeFailureError) {
    super(runtimeFailure.message, { cause: runtimeFailure })
    this.name = 'RepoMutationRuntimeFailureError'
    this.mutation = mutation
    this.runtimeFailure = runtimeFailure
  }
}

export function isRepoMutationRuntimeFailureError(error: unknown): error is RepoMutationRuntimeFailureError {
  return error instanceof RepoMutationRuntimeFailureError
}
