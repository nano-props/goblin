import type { WorkspaceRuntimeEpochCapability } from '#/server/workspaces/runtime/authority.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
import { workspaceGitCapabilityTransition } from '#/server/workspaces/runtime/capability-transition.ts'
import { CodedError } from '#/shared/coded-error.ts'

export type WorkspaceCapabilityTransitionCommitResult =
  | { kind: 'committed' }
  | { kind: 'failed-before-commit'; error: unknown }
  | { kind: 'committed-authority-uncertain'; error: unknown }

export interface WorkspaceCapabilityTransitionCommitInput {
  runtimeCapability: WorkspaceRuntimeEpochCapability
}

export interface WorkspaceCapabilityTransitionHost {
  commitGitCapabilityPromotion(
    input: WorkspaceCapabilityTransitionCommitInput,
  ): Promise<WorkspaceCapabilityTransitionCommitResult>
  commitGitCapabilityRemoval(
    input: WorkspaceCapabilityTransitionCommitInput,
  ): Promise<WorkspaceCapabilityTransitionCommitResult>
}

export function assertWorkspaceCapabilityTransitionCommitted(result: WorkspaceCapabilityTransitionCommitResult): void {
  if (result.kind === 'failed-before-commit') throw result.error
  if (result.kind === 'committed-authority-uncertain') {
    throw new CodedError({
      code: 'OUTCOME_UNCERTAIN',
      message: 'error.operation-outcome-uncertain',
      cause: result.error,
    })
  }
}

export async function commitWorkspaceCapabilityTransitionOrThrow(
  host: WorkspaceCapabilityTransitionHost,
  input: WorkspaceCapabilityTransitionCommitInput & {
    before: WorkspaceProbeState
    after: WorkspaceSettledProbeState
  },
): Promise<void> {
  const transition = workspaceGitCapabilityTransition(input.before, input.after)
  if (!transition) return
  const commitInput = { runtimeCapability: input.runtimeCapability }
  const result =
    transition === 'promotion'
      ? await host.commitGitCapabilityPromotion(commitInput)
      : await host.commitGitCapabilityRemoval(commitInput)
  assertWorkspaceCapabilityTransitionCommitted(result)
}
