import { isValidRepoLocator } from '#/shared/input-validation.ts'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
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
      if (!validInputTarget(input)) return emptyWorkspacePaneTabsSnapshot()
      assertCurrentRepoRuntime(userId, input.workspaceId, input.workspaceRuntimeId)
      return await sessionService.replaceTabs(userId, input)
    },

    async updateTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsUpdateInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!validInputTarget(input)) return emptyWorkspacePaneTabsSnapshot()
      assertCurrentRepoRuntime(userId, input.workspaceId, input.workspaceRuntimeId)
      return await sessionService.updateTabs(userId, input)
    },

    async listWorkspaceTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsListInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!isValidRepoLocator(input?.workspaceId)) return emptyWorkspacePaneTabsSnapshot()
      assertCurrentRepoRuntime(userId, input.workspaceId, input.workspaceRuntimeId)
      return await sessionService.listWorkspaceTabs(userId, input.workspaceId, input.workspaceRuntimeId)
    },
  }

  function assertCurrentRepoRuntime(userId: string, repoRoot: string, repoRuntimeId: string): void {
    if (!deps.isCurrentRepoRuntime(userId, repoRoot, repoRuntimeId)) {
      throw new Error('error.repo-runtime-stale')
    }
  }
}

function validInputTarget(input: WorkspacePaneTabsReplaceInput | WorkspacePaneTabsUpdateInput): boolean {
  return Boolean(
    isValidRepoLocator(input?.workspaceId) &&
      input.target.workspaceId === input.workspaceId &&
      input.target.workspaceRuntimeId === input.workspaceRuntimeId &&
      workspacePaneTabsTargetFromRuntime(input.target),
  )
}

function emptyWorkspacePaneTabsSnapshot(): WorkspacePaneTabsSnapshot {
  return { revision: 0, entries: [] }
}
