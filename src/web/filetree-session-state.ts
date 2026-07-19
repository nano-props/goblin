import type { ClientWorkspaceState, FiletreeSessionViewState } from '#/shared/api-types.ts'
import {
  filetreeInteractionScopeKey,
  parseFiletreeInteractionScopeKey,
  useFiletreeInteractionStore,
  type FiletreeInteractionSnapshot,
} from '#/web/stores/workspaces/filetree-interaction-state.ts'
import {
  canonicalWorkspaceLocator,
  parseCanonicalWorkspaceLocator,
  workspaceLocatorForPath,
  workspaceLocatorsShareTransport,
  type WorkspaceId,
} from '#/shared/workspace-locator.ts'

interface ClientWorkspaceFilesystemTargetsProjection {
  gitTargets?: {
    branches: ReadonlyArray<{ worktree?: { path?: string } | undefined }>
  }
}

export function persistedFiletreeViewStateByWorktreeByWorkspaceForSession(
  interactionByScope: Readonly<Record<string, FiletreeInteractionSnapshot>>,
  workspaces: Record<string, ClientWorkspaceFilesystemTargetsProjection | undefined>,
  workspaceOrder: readonly string[],
): ClientWorkspaceState['filetreeViewStateByWorktreeByWorkspace'] {
  const openWorkspaceIds = new Set(workspaceOrder)
  const byWorkspace: ClientWorkspaceState['filetreeViewStateByWorktreeByWorkspace'] = {}
  for (const [scopeKey, snapshot] of Object.entries(interactionByScope)) {
    const scope = parseFiletreeInteractionScopeKey(scopeKey)
    if (!scope || !openWorkspaceIds.has(scope.workspaceId)) continue
    const workspace = workspaces[scope.workspaceId]
    if (!workspace || !knownFilesystemRootPaths(scope.workspaceId, workspace).has(scope.rootPath)) continue
    const viewState = sessionViewStateFromInteractionSnapshot(snapshot)
    if (!hasRestorableFiletreeViewState(viewState)) continue
    byWorkspace[scope.workspaceId] ??= {}
    const worktreeId = workspaceLocatorForPath(scope.workspaceId, scope.rootPath)
    if (!worktreeId) continue
    byWorkspace[scope.workspaceId][worktreeId] = viewState
  }
  return byWorkspace
}

export function restoreFiletreeViewStateFromSession(
  filetreeViewStateByWorktreeByWorkspace: ClientWorkspaceState['filetreeViewStateByWorktreeByWorkspace'],
): void {
  useFiletreeInteractionStore
    .getState()
    .restoreViewState(interactionByScopeFromSessionViewState(filetreeViewStateByWorktreeByWorkspace))
}

function interactionByScopeFromSessionViewState(
  filetreeViewStateByWorktreeByWorkspace: ClientWorkspaceState['filetreeViewStateByWorktreeByWorkspace'],
): Record<string, FiletreeInteractionSnapshot> {
  const interactionByScope: Record<string, FiletreeInteractionSnapshot> = {}
  for (const [workspaceIdInput, byWorktree] of Object.entries(filetreeViewStateByWorktreeByWorkspace)) {
    const workspaceId = canonicalWorkspaceLocator(workspaceIdInput)
    if (!workspaceId) continue
    for (const [worktreeId, viewState] of Object.entries(byWorktree)) {
      if (!workspaceLocatorsShareTransport(workspaceId, worktreeId)) continue
      const worktreePath = parseCanonicalWorkspaceLocator(worktreeId)?.path
      if (!worktreePath) continue
      interactionByScope[filetreeInteractionScopeKey(workspaceId, worktreePath)] = {
        selectedKeys: viewState.selectedKeys,
        expandedKeys: viewState.expandedKeys,
        topVisibleRowIndex: viewState.topVisibleRowIndex,
      }
    }
  }
  return interactionByScope
}

function sessionViewStateFromInteractionSnapshot(snapshot: FiletreeInteractionSnapshot): FiletreeSessionViewState {
  return {
    selectedKeys: [...snapshot.selectedKeys],
    expandedKeys: [...snapshot.expandedKeys],
    topVisibleRowIndex: snapshot.topVisibleRowIndex,
  }
}

function hasRestorableFiletreeViewState(viewState: FiletreeSessionViewState): boolean {
  return viewState.selectedKeys.length > 0 || viewState.expandedKeys.length > 0 || viewState.topVisibleRowIndex > 0
}

function knownFilesystemRootPaths(
  workspaceId: WorkspaceId,
  workspace: ClientWorkspaceFilesystemTargetsProjection,
): ReadonlySet<string> {
  const workspaceRoot = parseCanonicalWorkspaceLocator(workspaceId)?.path
  return new Set([
    ...(workspaceRoot ? [workspaceRoot] : []),
    ...(workspace.gitTargets?.branches ?? []).map((branch) => branch.worktree?.path).filter(isNonEmptyString),
  ])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
