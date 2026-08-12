import { isValidWorkspaceLocatorInput } from '#/shared/input-validation.ts'
import { restorableWorkspacePaneTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import type {
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
  WorkspacePaneTabsWriteResult,
} from '#/shared/workspace-pane-tabs.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceRuntimeMembershipCapability } from '#/server/modules/workspace-runtimes.ts'

export interface WorkspacePaneTabsActionService {
  listWorkspaceTabs(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    runtimeCapability: WorkspaceRuntimeMembershipCapability,
  ): Promise<WorkspacePaneTabsSnapshot>
  updateTabs(
    userId: string,
    input: WorkspacePaneTabsUpdateInput,
    runtimeCapability: WorkspaceRuntimeMembershipCapability,
  ): Promise<WorkspacePaneTabsWriteResult>
}

export interface WorkspacePaneTabsActionDependencies {
  sessionService: WorkspacePaneTabsActionService
  isValidClientId(value: unknown): value is string
  captureWorkspaceRuntimeMembershipCapability(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    clientId: string,
  ): WorkspaceRuntimeMembershipCapability
}

export function createWorkspacePaneTabsActions(deps: WorkspacePaneTabsActionDependencies) {
  const { sessionService, isValidClientId } = deps

  return {
    async updateTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsUpdateInput,
    ): Promise<WorkspacePaneTabsWriteResult> {
      if (!isValidClientId(clientId)) throw new Error('invalid workspace pane tabs client')
      if (!validInputTarget(input)) throw new Error('invalid workspace pane tabs target')
      const runtimeCapability = deps.captureWorkspaceRuntimeMembershipCapability(
        userId,
        input.workspaceId,
        input.workspaceRuntimeId,
        clientId,
      )
      return await sessionService.updateTabs(userId, input, runtimeCapability)
    },

    async listWorkspaceTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsListInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!isValidClientId(clientId)) throw new Error('invalid workspace pane tabs client')
      if (!isValidWorkspaceLocatorInput(input?.workspaceId)) throw new Error('invalid workspace pane tabs target')
      const runtimeCapability = deps.captureWorkspaceRuntimeMembershipCapability(
        userId,
        input.workspaceId,
        input.workspaceRuntimeId,
        clientId,
      )
      return await sessionService.listWorkspaceTabs(
        userId,
        input.workspaceId,
        input.workspaceRuntimeId,
        runtimeCapability,
      )
    },
  }
}

function validInputTarget(input: WorkspacePaneTabsUpdateInput): boolean {
  return Boolean(
    isValidWorkspaceLocatorInput(input?.workspaceId) &&
    input.target.workspaceId === input.workspaceId &&
    input.target.workspaceRuntimeId === input.workspaceRuntimeId &&
    restorableWorkspacePaneTargetFromRuntime(input.target),
  )
}
