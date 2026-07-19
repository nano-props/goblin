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

export function persistedFiletreeViewStateByFilesystemTargetByWorkspaceForSession(
  interactionByScope: Readonly<Record<string, FiletreeInteractionSnapshot>>,
  workspaces: Record<string, ClientWorkspaceFilesystemTargetsProjection | undefined>,
  workspaceOrder: readonly string[],
): ClientWorkspaceState['filetreeViewStateByFilesystemTargetByWorkspace'] {
  const openWorkspaceIds = new Set(workspaceOrder)
  const byWorkspace: ClientWorkspaceState['filetreeViewStateByFilesystemTargetByWorkspace'] = {}
  for (const [scopeKey, snapshot] of Object.entries(interactionByScope)) {
    const scope = parseFiletreeInteractionScopeKey(scopeKey)
    if (!scope || !openWorkspaceIds.has(scope.workspaceId)) continue
    const workspace = workspaces[scope.workspaceId]
    if (!workspace || !knownFilesystemRootPaths(scope.workspaceId, workspace).has(scope.rootPath)) continue
    const viewState = sessionViewStateFromInteractionSnapshot(snapshot)
    if (!hasRestorableFiletreeViewState(viewState)) continue
    byWorkspace[scope.workspaceId] ??= {}
    const filesystemTargetId = workspaceLocatorForPath(scope.workspaceId, scope.rootPath)
    if (!filesystemTargetId) continue
    byWorkspace[scope.workspaceId][filesystemTargetId] = viewState
  }
  return byWorkspace
}

export function restoreFiletreeViewStateFromSession(
  filetreeViewStateByFilesystemTargetByWorkspace: ClientWorkspaceState['filetreeViewStateByFilesystemTargetByWorkspace'],
): void {
  useFiletreeInteractionStore
    .getState()
    .restoreViewState(interactionByScopeFromSessionViewState(filetreeViewStateByFilesystemTargetByWorkspace))
}

function interactionByScopeFromSessionViewState(
  filetreeViewStateByFilesystemTargetByWorkspace: ClientWorkspaceState['filetreeViewStateByFilesystemTargetByWorkspace'],
): Record<string, FiletreeInteractionSnapshot> {
  const interactionByScope: Record<string, FiletreeInteractionSnapshot> = {}
  for (const [workspaceIdInput, byFilesystemTarget] of Object.entries(filetreeViewStateByFilesystemTargetByWorkspace)) {
    const workspaceId = canonicalWorkspaceLocator(workspaceIdInput)
    if (!workspaceId) continue
    for (const [filesystemTargetId, viewState] of Object.entries(byFilesystemTarget)) {
      if (!workspaceLocatorsShareTransport(workspaceId, filesystemTargetId)) continue
      const filesystemTargetPath = parseCanonicalWorkspaceLocator(filesystemTargetId)?.path
      if (!filesystemTargetPath) continue
      interactionByScope[filetreeInteractionScopeKey(workspaceId, filesystemTargetPath)] = {
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
