export interface WorkspaceCapabilityTransitionHost {
  removeGitScopedResources(input: {
    userId: string
    workspaceId: string
    workspaceRuntimeId: string
    assertCurrent: () => void
  }): Promise<void>
}
