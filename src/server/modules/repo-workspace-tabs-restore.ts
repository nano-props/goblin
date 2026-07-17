import { IpcError, type RestoredWorkspaceRepoRuntime, type RepoWorkspaceTabsRestoreResult } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  isCurrentRepoRuntimeMembership,
  runSerializedInitialWorkspaceProbe,
  workspaceProbeStateForRuntime,
  isCurrentRepoRuntime,
} from '#/server/modules/repo-runtimes.ts'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import { confirmServerWorkspaceRepoEntry, getServerWorkspaceState } from '#/server/modules/settings-source.ts'
import {
  projectWorkspacePaneTabsWithMembershipGuard,
  workspaceRepoEntry,
} from '#/server/modules/workspace-pane-tabs-restore.ts'
import { abortableWorkspaceRestore, workspaceRepoDisplayName } from '#/server/modules/workspace-restore-utils.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { probeWorkspace } from '#/server/modules/workspace-probe.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

interface RestoreRepoTabsInput {
  userId: string
  clientId: string
  repoRoot: string
  repoRuntimeId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
  signal?: AbortSignal
}

export async function restoreRepoTabsForRepo(input: RestoreRepoTabsInput): Promise<RepoWorkspaceTabsRestoreResult> {
  input.signal?.throwIfAborted()
  assertCurrentRepoRuntimeMembership(input)
  const initialWorkspace = await getServerWorkspaceState()
  assertCurrentRepoRuntimeMembership(input)
  const entry = workspaceRepoEntry(initialWorkspace, input.repoRoot)
  if (!entry) throw repoNotInWorkspace()
  const repo = await projectWorkspaceRepo(input, entry)
  if (!repo) throw new IpcError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })

  const projectedTabs = await projectWorkspacePaneTabsWithMembershipGuard({
    restoreInput: input,
    repos: [repo],
    confirmMembership: async () => await confirmServerWorkspaceRepoEntry(entry),
    membershipPolicy: 'transaction-authoritative',
    assertCurrent: () => assertCurrentRepoRuntimeMembership(input),
  })
  if (!projectedTabs.matched) throw repoNotInWorkspace()
  return { repo, snapshot: projectedTabs.snapshots[0]?.snapshot ?? null }
}

async function projectWorkspaceRepo(
  input: RestoreRepoTabsInput,
  entry: WorkspaceSessionEntry,
): Promise<RestoredWorkspaceRepoRuntime | null> {
  if (entry.kind === 'remote') {
    const lifecycle = await abortableWorkspaceRestore(
      runRemoteLifecycleWrite(
        {
          userId: input.userId,
          repoId: entry.id,
          repoRuntimeId: input.repoRuntimeId,
          mode: 'ensure',
        },
        {
          beforeCapabilityCommit: async ({ before, after }) => {
            if (!workspaceGitCleanupRequired(before, after)) return
            await input.workspaceCapabilityTransitionHost.removeGitScopedResources({
              userId: input.userId,
              workspaceId: entry.id,
              workspaceRuntimeId: input.repoRuntimeId,
              assertCurrent: () => {
                if (!isCurrentRepoRuntime(input.userId, entry.id, input.repoRuntimeId)) {
                  throw new Error('error.repo-runtime-stale')
                }
              },
            })
          },
        },
      ),
      input.signal,
    )
    assertCurrentRepoRuntimeMembership(input)
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') return null
    const workspaceProbe = workspaceProbeStateForRuntime(input.userId, entry.id, input.repoRuntimeId)
    if (!workspaceProbe || workspaceProbe.status !== 'ready') return null
    if (workspaceProbe.capabilities.git.status === 'unavailable') {
      return {
        entry,
        repoRoot: entry.id,
        repoRuntimeId: input.repoRuntimeId,
        name: lifecycle.name,
        target: lifecycle.lifecycle.target,
        workspaceProbe,
        projection: null,
      }
    }
    const projection = await readRepoProjection(entry.id, {
      repoRuntimeId: input.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    assertCurrentRepoRuntimeMembership(input)
    if (!projection.snapshot) return null
    return {
      entry,
      repoRoot: entry.id,
      repoRuntimeId: input.repoRuntimeId,
      name: lifecycle.name,
      target: lifecycle.lifecycle.target,
      workspaceProbe,
      projection,
    }
  }
  let probe = workspaceProbeStateForRuntime(input.userId, entry.id, input.repoRuntimeId)
  if (!probe) return null
  if (probe.status === 'probing') {
    const authoritativeProbe = await runSerializedInitialWorkspaceProbe({
      userId: input.userId,
      repoRoot: entry.id,
      repoRuntimeId: input.repoRuntimeId,
      probe: async () =>
        await probeWorkspace(entry.id, process.platform === 'win32' ? 'win32' : 'posix', {
          signal: input.signal,
        }),
      beforeCommit: async ({ before, after }) => {
        if (!workspaceGitCleanupRequired(before, after)) return
        await input.workspaceCapabilityTransitionHost.removeGitScopedResources({
          userId: input.userId,
          workspaceId: entry.id,
          workspaceRuntimeId: input.repoRuntimeId,
          assertCurrent: () => assertCurrentRepoRuntimeMembership(input),
        })
      },
    })
    if (!authoritativeProbe) return null
    probe = authoritativeProbe
  }
  if (probe.status !== 'ready') return null
  if (probe.capabilities.git.status === 'unavailable') {
    return {
      entry,
      repoRoot: entry.id,
      repoRuntimeId: input.repoRuntimeId,
      name: probe.name ?? workspaceRepoDisplayName(entry.id),
      workspaceProbe: probe,
      projection: null,
    }
  }
  const projection = await readRepoProjection(entry.id, {
    repoRuntimeId: input.repoRuntimeId,
    signal: input.signal,
    mode: 'full',
  })
  assertCurrentRepoRuntimeMembership(input)
  if (!projection.snapshot) return null
  return {
    entry,
    repoRoot: entry.id,
    repoRuntimeId: input.repoRuntimeId,
    name: probe.name ?? workspaceRepoDisplayName(entry.id),
    workspaceProbe: probe,
    projection,
  }
}

function assertCurrentRepoRuntimeMembership(input: RestoreRepoTabsInput): void {
  if (isCurrentRepoRuntimeMembership(input.userId, input.repoRoot, input.repoRuntimeId, input.clientId)) return
  throw new IpcError({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
}

function repoNotInWorkspace(): IpcError {
  return new IpcError({ code: 'NOT_FOUND', message: 'error.repo-not-in-session' })
}
