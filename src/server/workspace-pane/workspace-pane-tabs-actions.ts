import { isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsEntry,
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'

export interface WorkspacePaneTabsActionService {
  listWorkspaceTabs(userId: string, repoRoot: string, repoRuntimeId: string): Promise<WorkspacePaneTabsEntry[]>
  replaceTabs(userId: string, input: WorkspacePaneTabsReplaceInput): Promise<WorkspacePaneTabEntry[]>
  updateTabs(userId: string, input: WorkspacePaneTabsUpdateInput): Promise<WorkspacePaneTabEntry[]>
}

export interface WorkspacePaneTabsActionDependencies {
  sessionService: WorkspacePaneTabsActionService
  isValidClientId(value: unknown): value is string
  isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: string): void
}

export function createWorkspacePaneTabsActions(deps: WorkspacePaneTabsActionDependencies) {
  const { sessionService, isValidClientId } = deps

  return {
    async replaceTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsReplaceInput,
    ): Promise<WorkspacePaneTabEntry[]> {
      if (!isValidClientId(clientId)) return []
      if (!isValidRepoLocator(input?.repoRoot)) return []
      if (input?.worktreePath !== null && !isValidCwd(input?.worktreePath)) return []
      assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
      const tabs = await sessionService.replaceTabs(userId, input)
      deps.broadcastWorkspaceTabsChanged(userId, input.repoRoot)
      return tabs
    },

    async updateTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsUpdateInput,
    ): Promise<WorkspacePaneTabEntry[]> {
      if (!isValidClientId(clientId)) return []
      if (!isValidRepoLocator(input?.repoRoot)) return []
      if (input?.worktreePath !== null && !isValidCwd(input?.worktreePath)) return []
      assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
      const tabs = await sessionService.updateTabs(userId, input)
      deps.broadcastWorkspaceTabsChanged(userId, input.repoRoot)
      return tabs
    },

    async listWorkspaceTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsListInput,
    ): Promise<WorkspacePaneTabsEntry[]> {
      if (!isValidClientId(clientId)) return []
      if (!isValidRepoLocator(input?.repoRoot)) return []
      assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
      return await sessionService.listWorkspaceTabs(userId, input.repoRoot, input.repoRuntimeId)
    },
  }

  function assertCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): void {
    if (!deps.isCurrentRepoRuntime(userId, repoRoot, repoRuntimeId)) {
      throw new Error('error.repo-runtime-stale')
    }
  }
}
