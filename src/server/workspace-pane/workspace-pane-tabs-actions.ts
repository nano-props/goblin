import { isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
import type {
  WorkspacePaneTabsBatchReplaceInput,
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
  broadcastWorkspaceTabsChanged(userId: string, repoRoot: string): void
  persistWorkspaceTabs(repoRoot: string, snapshot: WorkspacePaneTabsSnapshot): Promise<unknown>
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
      const tabs = await sessionService.replaceTabs(userId, input)
      await deps.persistWorkspaceTabs(input.repoRoot, tabs)
      deps.broadcastWorkspaceTabsChanged(userId, input.repoRoot)
      return tabs
    },

    async replaceTabsBatch(
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsBatchReplaceInput,
    ): Promise<Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>> {
      if (!isValidClientId(clientId)) return []
      if (!Array.isArray(input?.replacements)) return []
      const snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }> = []
      for (const replacement of input.replacements) {
        if (!isValidRepoLocator(replacement?.repoRoot)) return []
        if (replacement?.worktreePath !== null && !isValidCwd(replacement?.worktreePath)) return []
        assertCurrentRepoRuntime(userId, replacement.repoRoot, replacement.repoRuntimeId)
      }
      for (const replacement of input.replacements) {
        const snapshot = await sessionService.replaceTabs(userId, replacement)
        await deps.persistWorkspaceTabs(replacement.repoRoot, snapshot)
        const index = snapshots.findIndex(
          (entry) => entry.repoRoot === replacement.repoRoot && entry.repoRuntimeId === replacement.repoRuntimeId,
        )
        const entry = { repoRoot: replacement.repoRoot, repoRuntimeId: replacement.repoRuntimeId, snapshot }
        if (index === -1) snapshots.push(entry)
        else snapshots[index] = entry
      }
      for (const repoRoot of new Set(input.replacements.map((replacement) => replacement.repoRoot))) {
        deps.broadcastWorkspaceTabsChanged(userId, repoRoot)
      }
      return snapshots
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
      const tabs = await sessionService.updateTabs(userId, input)
      await deps.persistWorkspaceTabs(input.repoRoot, tabs)
      deps.broadcastWorkspaceTabsChanged(userId, input.repoRoot)
      return tabs
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
