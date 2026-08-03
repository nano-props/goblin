import { isValidWorkspaceLocatorInput } from '#/shared/input-validation.ts'
import { restorableWorkspacePaneTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import type {
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface WorkspacePaneTabsActionService {
  listWorkspaceTabs(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    assertCurrentMembership: () => void,
  ): Promise<WorkspacePaneTabsSnapshot>
  replaceTabs(
    userId: string,
    input: WorkspacePaneTabsReplaceInput,
    assertCurrentMembership: () => void,
  ): Promise<WorkspacePaneTabsSnapshot>
  updateTabs(
    userId: string,
    input: WorkspacePaneTabsUpdateInput,
    assertCurrentMembership: () => void,
  ): Promise<WorkspacePaneTabsSnapshot>
}

export interface WorkspacePaneTabsActionDependencies {
  sessionService: WorkspacePaneTabsActionService
  isValidClientId(value: unknown): value is string
  isCurrentWorkspaceRuntimeMembership(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
    clientId: string,
  ): boolean
}

export function createWorkspacePaneTabsActions(deps: WorkspacePaneTabsActionDependencies) {
  return {
    async replaceTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsReplaceInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!deps.isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!validInputTarget(input)) return emptyWorkspacePaneTabsSnapshot()
      const assertCurrentMembership = membershipAssertion(clientId, userId, input.workspaceId, input.workspaceRuntimeId)
      assertCurrentMembership()
      return await deps.sessionService.replaceTabs(userId, input, assertCurrentMembership)
    },

    async updateTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsUpdateInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!deps.isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!validInputTarget(input)) return emptyWorkspacePaneTabsSnapshot()
      const assertCurrentMembership = membershipAssertion(clientId, userId, input.workspaceId, input.workspaceRuntimeId)
      assertCurrentMembership()
      return await deps.sessionService.updateTabs(userId, input, assertCurrentMembership)
    },

    async listWorkspaceTabs(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsListInput,
    ): Promise<WorkspacePaneTabsSnapshot> {
      if (!deps.isValidClientId(clientId)) return emptyWorkspacePaneTabsSnapshot()
      if (!isValidWorkspaceLocatorInput(input?.workspaceId)) return emptyWorkspacePaneTabsSnapshot()
      const assertCurrentMembership = membershipAssertion(clientId, userId, input.workspaceId, input.workspaceRuntimeId)
      assertCurrentMembership()
      return await deps.sessionService.listWorkspaceTabs(
        userId,
        input.workspaceId,
        input.workspaceRuntimeId,
        assertCurrentMembership,
      )
    },
  }

  function membershipAssertion(
    clientId: string,
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
  ): () => void {
    return () => {
      if (!deps.isCurrentWorkspaceRuntimeMembership(userId, workspaceId, workspaceRuntimeId, clientId)) {
        throw new Error('error.workspace-runtime-stale')
      }
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
