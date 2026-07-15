import { isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import type {
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'

export interface WorkspacePaneTabsActionService {
  listWorkspaceTabs(userId: string, repoRoot: string, repoRuntimeId: string): Promise<WorkspacePaneTabsSnapshot>
  replaceTabs(userId: string, input: WorkspacePaneTabsReplaceInput): Promise<WorkspacePaneTabsSnapshot>
  updateTabs(userId: string, input: WorkspacePaneTabsUpdateInput): Promise<WorkspacePaneTabsSnapshot>
}

export interface WorkspacePaneTabsActionDependencies {
  sessionService: WorkspacePaneTabsActionService
  isValidClientId(value: unknown): value is string
  isCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): boolean
}

export function createWorkspacePaneTabsActions(deps: WorkspacePaneTabsActionDependencies) {
  const { sessionService, isValidClientId } = deps

  return {
    async replaceTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsReplaceInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!isValidRepoLocator(input?.repoRoot)) return emptyWorkspacePaneTabsSnapshot()
      if (input?.worktreePath !== null && !isValidCwd(input?.worktreePath)) return emptyWorkspacePaneTabsSnapshot()
      assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
      return await sessionService.replaceTabs(userId, input)
    },

    async updateTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsUpdateInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!isValidRepoLocator(input?.repoRoot)) return emptyWorkspacePaneTabsSnapshot()
      if (input?.worktreePath !== null && !isValidCwd(input?.worktreePath)) return emptyWorkspacePaneTabsSnapshot()
      assertCurrentRepoRuntime(userId, input.repoRoot, input.repoRuntimeId)
      return await sessionService.updateTabs(userId, input)
    },

    async listWorkspaceTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsListInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!isValidRepoLocator(input?.repoRoot)) return emptyWorkspacePaneTabsSnapshot()
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

function emptyWorkspacePaneTabsSnapshot(): WorkspacePaneTabsSnapshot {
  return { revision: 0, entries: [] }
}
