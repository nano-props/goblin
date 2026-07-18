import type { ClientWorkspaceState, FiletreeSessionViewState } from '#/shared/api-types.ts'
import {
  filetreeInteractionScopeKey,
  parseFiletreeInteractionScopeKey,
  useFiletreeInteractionStore,
  type FiletreeInteractionSnapshot,
} from '#/web/stores/repos/filetree-interaction-state.ts'
import {
  canonicalWorkspaceLocator,
  parseCanonicalWorkspaceLocator,
  workspaceLocatorForPath,
  workspaceLocatorsShareTransport,
} from '#/shared/workspace-locator.ts'

interface RepoWorktreeProjection {
  branches: ReadonlyArray<{ worktree?: { path?: string } | undefined }>
}

export function persistedFiletreeViewStateByWorktreeByRepoForSession(
  interactionByScope: Readonly<Record<string, FiletreeInteractionSnapshot>>,
  repos: Record<string, RepoWorktreeProjection | undefined>,
  order: readonly string[],
): ClientWorkspaceState['filetreeViewStateByWorktreeByRepo'] {
  const openRepoIds = new Set(order)
  const byRepo: ClientWorkspaceState['filetreeViewStateByWorktreeByRepo'] = {}
  for (const [scopeKey, snapshot] of Object.entries(interactionByScope)) {
    const scope = parseFiletreeInteractionScopeKey(scopeKey)
    if (!scope || !openRepoIds.has(scope.repoId)) continue
    const repo = repos[scope.repoId]
    if (!repo || !knownFilesystemRootPaths(scope.repoId, repo).has(scope.worktreePath)) continue
    const viewState = sessionViewStateFromInteractionSnapshot(snapshot)
    if (!hasRestorableFiletreeViewState(viewState)) continue
    byRepo[scope.repoId] ??= {}
    const workspaceId = canonicalWorkspaceLocator(scope.repoId)
    const worktreeId = workspaceId ? workspaceLocatorForPath(workspaceId, scope.worktreePath) : null
    if (!worktreeId) continue
    byRepo[scope.repoId][worktreeId] = viewState
  }
  return byRepo
}

export function restoreFiletreeViewStateFromSession(
  filetreeViewStateByWorktreeByRepo: ClientWorkspaceState['filetreeViewStateByWorktreeByRepo'],
): void {
  useFiletreeInteractionStore
    .getState()
    .restoreViewState(interactionByScopeFromSessionViewState(filetreeViewStateByWorktreeByRepo))
}

function interactionByScopeFromSessionViewState(
  filetreeViewStateByWorktreeByRepo: ClientWorkspaceState['filetreeViewStateByWorktreeByRepo'],
): Record<string, FiletreeInteractionSnapshot> {
  const interactionByScope: Record<string, FiletreeInteractionSnapshot> = {}
  for (const [repoId, byWorktree] of Object.entries(filetreeViewStateByWorktreeByRepo)) {
    if (!repoId || repoId.includes('\0')) continue
    for (const [worktreeId, viewState] of Object.entries(byWorktree)) {
      if (!workspaceLocatorsShareTransport(repoId, worktreeId)) continue
      const worktreePath = parseCanonicalWorkspaceLocator(worktreeId)?.path
      if (!worktreePath) continue
      interactionByScope[filetreeInteractionScopeKey(repoId, worktreePath)] = {
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

function knownFilesystemRootPaths(workspaceId: string, repo: RepoWorktreeProjection): ReadonlySet<string> {
  const workspaceRoot = parseCanonicalWorkspaceLocator(workspaceId)?.path
  return new Set([
    ...(workspaceRoot ? [workspaceRoot] : []),
    ...repo.branches.map((branch) => branch.worktree?.path).filter(isNonEmptyString),
  ])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
