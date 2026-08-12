import type { WorkspaceRuntimeEpochCapability } from '#/server/modules/workspace-runtimes.ts'

export type WorkspaceCapabilityTransitionCommitResult =
  { kind: 'committed' } | { kind: 'failed-before-commit'; error: unknown }

export interface WorkspaceCapabilityTransitionCommitInput {
  runtimeCapability: WorkspaceRuntimeEpochCapability
}

export interface WorkspaceCapabilityTransitionHost {
  commitGitCapabilityRemoval(
    input: WorkspaceCapabilityTransitionCommitInput,
  ): Promise<WorkspaceCapabilityTransitionCommitResult>
}

export function assertWorkspaceCapabilityTransitionCommitted(result: WorkspaceCapabilityTransitionCommitResult): void {
  if (result.kind === 'failed-before-commit') throw result.error
}

export async function commitGitCapabilityRemovalOrThrow(
  host: WorkspaceCapabilityTransitionHost,
  input: WorkspaceCapabilityTransitionCommitInput,
): Promise<void> {
  assertWorkspaceCapabilityTransitionCommitted(await host.commitGitCapabilityRemoval(input))
}
