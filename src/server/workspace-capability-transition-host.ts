export type WorkspaceCapabilityTransitionCommitResult =
  { kind: 'committed' } | { kind: 'failed-before-commit'; error: unknown }

export interface WorkspaceCapabilityTransitionCommitInput {
  userId: string
  workspaceId: string
  workspaceRuntimeId: string
  assertCurrent: () => void
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
