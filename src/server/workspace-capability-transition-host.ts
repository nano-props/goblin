export interface WorkspaceCapabilityTransitionHost {
  removeGitScopedResources(input: {
    userId: string
    workspaceId: string
    workspaceRuntimeId: string
  }): Promise<void>
}
