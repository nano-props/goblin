import {
  IpcError,
  type ProjectedRestoredWorkspaceRepoRuntime,
  type RepoWorkspaceTabsRestoreResult,
} from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  commitWorkspaceProbeState,
  isCurrentRepoRuntimeMembership,
  workspaceProbeStateForRuntime,
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

interface RestoreRepoTabsInput {
  userId: string
  clientId: string
  repoRoot: string
  repoRuntimeId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
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
): Promise<ProjectedRestoredWorkspaceRepoRuntime | null> {
  if (entry.kind === 'remote') {
    const lifecycle = await abortableWorkspaceRestore(
      runRemoteLifecycleWrite({
        userId: input.userId,
        repoId: entry.id,
        repoRuntimeId: input.repoRuntimeId,
        mode: 'ensure',
      }),
      input.signal,
    )
    assertCurrentRepoRuntimeMembership(input)
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') return null
    const workspaceProbe = workspaceProbeStateForRuntime(input.userId, entry.id, input.repoRuntimeId)
    if (
      !workspaceProbe ||
      workspaceProbe.status !== 'ready' ||
      workspaceProbe.capabilities.git.status !== 'available'
    ) {
      return null
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
  const probe = await probeWorkspace(entry.id, process.platform === 'win32' ? 'win32' : 'posix', {
    signal: input.signal,
  })
  assertCurrentRepoRuntimeMembership(input)
  if (
    !commitWorkspaceProbeState({
      userId: input.userId,
      repoRoot: entry.id,
      repoRuntimeId: input.repoRuntimeId,
      probe,
    })
  )
    return null
  if (probe.status !== 'ready' || probe.capabilities.git.status !== 'available') return null
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
