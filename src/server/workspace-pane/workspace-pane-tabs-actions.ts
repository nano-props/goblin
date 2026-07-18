import { isValidWorkspaceLocatorInput } from '#/shared/input-validation.ts'
import { restorableWorkspacePaneTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import type {
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'

export interface WorkspacePaneTabsActionService {
  listWorkspaceTabs(userId: string, workspaceId: string, workspaceRuntimeId: string): Promise<WorkspacePaneTabsSnapshot>
  replaceTabs(userId: string, input: WorkspacePaneTabsReplaceInput): Promise<WorkspacePaneTabsSnapshot>
  updateTabs(userId: string, input: WorkspacePaneTabsUpdateInput): Promise<WorkspacePaneTabsSnapshot>
}

export interface WorkspacePaneTabsActionDependencies {
  sessionService: WorkspacePaneTabsActionService
  isValidClientId(value: unknown): value is string
  isCurrentWorkspaceRuntime(userId: string, workspaceId: string, workspaceRuntimeId: string): boolean
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
      assertCurrentWorkspaceRuntime(userId, input.workspaceId, input.workspaceRuntimeId)
      return await sessionService.replaceTabs(userId, input)
    },

    async updateTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsUpdateInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!validInputTarget(input)) return emptyWorkspacePaneTabsSnapshot()
      assertCurrentWorkspaceRuntime(userId, input.workspaceId, input.workspaceRuntimeId)
      return await sessionService.updateTabs(userId, input)
    },

    async listWorkspaceTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsListInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!isValidWorkspaceLocatorInput(input?.workspaceId)) return emptyWorkspacePaneTabsSnapshot()
      assertCurrentWorkspaceRuntime(userId, input.workspaceId, input.workspaceRuntimeId)
      return await sessionService.listWorkspaceTabs(userId, input.workspaceId, input.workspaceRuntimeId)
    },
  }

  function assertCurrentWorkspaceRuntime(userId: string, workspaceId: string, workspaceRuntimeId: string): void {
    if (!deps.isCurrentWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId)) {
      throw new Error('error.workspace-runtime-stale')
    }
  }
}

function validInputTarget(input: WorkspacePaneTabsReplaceInput | WorkspacePaneTabsUpdateInput): boolean {
  return Boolean(
    isValidWorkspaceLocatorInput(input?.workspaceId) &&
    input.target.workspaceId === input.workspaceId &&
    input.target.workspaceRuntimeId === input.workspaceRuntimeId &&
    restorableWorkspacePaneTargetFromRuntime(input.target),
  )
}

function emptyWorkspacePaneTabsSnapshot(): WorkspacePaneTabsSnapshot {
  return { revision: 0, entries: [] }
}
