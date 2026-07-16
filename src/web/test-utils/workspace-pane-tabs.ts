import type { QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import { formatWorkspaceLocator, parseWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  type WorkspacePaneTabsQueryData,
  workspacePaneTabsQueryKey,
  writeWorkspacePaneTabsSnapshotQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export function setWorkspacePaneTabsForTargetQueryData(
  input: {
    repoRoot: string
    repoRuntimeId: string
    branchName: string
    worktreePath: string | null
    tabs: readonly WorkspacePaneTabEntry[]
  },
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const current = currentSnapshot(input.repoRoot, input.repoRuntimeId, queryClient)
  writeWorkspacePaneTabsSnapshotQueryData(
    input.repoRoot,
    input.repoRuntimeId,
    {
      revision: current.revision,
      entries: [
        ...current.entries.filter((entry) => {
          const target = workspacePaneTabsTargetFromRuntime(entry.target)
          return !target || workspacePaneTabsTargetIdentityKey(target) !== workspacePaneTabsTargetIdentityKey(input)
        }),
        {
          target: runtimeWorkspacePaneTargetForTest(input),
          tabs: [...input.tabs],
        },
      ],
    },
    queryClient,
  )
}

export function replaceWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  entries: readonly WorkspacePaneTabsEntry[],
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const current = currentSnapshot(repoRoot, repoRuntimeId, queryClient)
  writeWorkspacePaneTabsSnapshotQueryData(
    repoRoot,
    repoRuntimeId,
    { revision: current.revision, entries: [...entries] },
    queryClient,
  )
}

function currentSnapshot(repoRoot: string, repoRuntimeId: string, queryClient: QueryClient): WorkspacePaneTabsSnapshot {
  return (
    queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(repoRoot, repoRuntimeId)) ?? {
      revision: 0,
      entries: [],
    }
  )
}

export function runtimeWorkspacePaneTargetForTest(input: {
  repoRoot: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
}) {
  const parsed = parseWorkspaceLocator(input.repoRoot, 'posix')
  const workspaceId = (parsed ? formatWorkspaceLocator(parsed, 'posix')! : input.repoRoot) as WorkspaceId
  if (input.worktreePath === input.repoRoot) {
    return { kind: 'workspace' as const, workspaceId, workspaceRuntimeId: input.repoRuntimeId }
  }
  if (input.worktreePath === null) {
    return {
      kind: 'git-branch' as const,
      workspaceId,
      workspaceRuntimeId: input.repoRuntimeId,
      branch: input.branchName,
    }
  }
  const root = (parsed
    ? formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: input.worktreePath }, 'posix')!
    : input.worktreePath) as WorkspaceId
  return { kind: 'git-worktree' as const, workspaceId, workspaceRuntimeId: input.repoRuntimeId, root }
}
