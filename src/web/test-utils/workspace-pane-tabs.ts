import type { QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  runtimeWorkspacePaneTarget,
  requiredGitWorkspacePaneTabsTarget,
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  type WorkspacePaneTabsQueryData,
  workspacePaneTabsQueryKey,
  writeWorkspacePaneTabsSnapshotQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export function setWorkspacePaneTabsForTargetQueryData(
  input:
    | (WorkspacePaneTabsTarget & { workspaceRuntimeId: string; tabs: readonly WorkspacePaneTabEntry[] })
    | {
        repoRoot: string
        workspaceRuntimeId: string
        branchName: string
        worktreePath: string | null
        tabs: readonly WorkspacePaneTabEntry[]
      },
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const resolvedTarget: WorkspacePaneTabsTarget & {
    workspaceRuntimeId: string
    tabs: readonly WorkspacePaneTabEntry[]
  } =
    'kind' in input
      ? input
      : {
          ...requiredGitWorkspacePaneTabsTarget(input.repoRoot, input.branchName, input.worktreePath),
          workspaceRuntimeId: input.workspaceRuntimeId,
          tabs: input.tabs,
        }
  const current = currentSnapshot(input.repoRoot, input.workspaceRuntimeId, queryClient)
  writeWorkspacePaneTabsSnapshotQueryData(
    input.repoRoot,
    input.workspaceRuntimeId,
    {
      revision: current.revision,
      entries: [
        ...current.entries.filter((entry) => {
          const target = workspacePaneTabsTargetFromRuntime(entry.target)
          return (
            !target || workspacePaneTabsTargetIdentityKey(target) !== workspacePaneTabsTargetIdentityKey(resolvedTarget)
          )
        }),
        {
          target: runtimeWorkspacePaneTargetForTest(resolvedTarget),
          tabs: [...input.tabs],
        },
      ],
    },
    queryClient,
  )
}

export function replaceWorkspacePaneTabsQueryData(
  repoRoot: string,
  workspaceRuntimeId: string,
  entries: readonly WorkspacePaneTabsEntry[],
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const current = currentSnapshot(repoRoot, workspaceRuntimeId, queryClient)
  writeWorkspacePaneTabsSnapshotQueryData(
    repoRoot,
    workspaceRuntimeId,
    { revision: current.revision, entries: [...entries] },
    queryClient,
  )
}

function currentSnapshot(
  repoRoot: string,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
): WorkspacePaneTabsSnapshot {
  return (
    queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(repoRoot, workspaceRuntimeId)) ?? {
      revision: 0,
      entries: [],
    }
  )
}

export function runtimeWorkspacePaneTargetForTest(
  input: Extract<WorkspacePaneTabsTarget, { kind: 'workspace-root' }> & { workspaceRuntimeId: string },
): Extract<RuntimeWorkspacePaneTarget, { kind: 'workspace-root' }>
export function runtimeWorkspacePaneTargetForTest(
  input: Extract<WorkspacePaneTabsTarget, { kind: 'git-worktree' }> & { workspaceRuntimeId: string },
): Extract<RuntimeWorkspacePaneTarget, { kind: 'git-worktree' }>
export function runtimeWorkspacePaneTargetForTest(input: {
  repoRoot: string
  workspaceRuntimeId: string
  branchName: string
  worktreePath: string
}): Extract<RuntimeWorkspacePaneTarget, { kind: 'git-worktree' }>
export function runtimeWorkspacePaneTargetForTest(
  input: WorkspacePaneTabsTarget & { workspaceRuntimeId: string },
): RuntimeWorkspacePaneTarget
export function runtimeWorkspacePaneTargetForTest(
  input:
    | (WorkspacePaneTabsTarget & { workspaceRuntimeId: string })
    | { repoRoot: string; workspaceRuntimeId: string; branchName: string; worktreePath: string },
) {
  const paneTarget =
    'kind' in input ? input : requiredGitWorkspacePaneTabsTarget(input.repoRoot, input.branchName, input.worktreePath)
  const target = runtimeWorkspacePaneTarget(paneTarget, input.workspaceRuntimeId)
  if (!target) throw new Error('workspace pane test target requires a canonical target')
  return target
}
