import {
  IpcError,
  type ProjectedRestoredWorkspaceRepoRuntime,
  type RepoWorkspaceTabsRestoreResult,
} from '#/shared/api-types.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { probeRepo, readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import { isCurrentRepoRuntimeMembership } from '#/server/modules/repo-runtimes.ts'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import { confirmServerWorkspaceRepoEntry, getServerWorkspaceState } from '#/server/modules/settings-source.ts'
import {
  initializeWorkspacePaneTabsWithMembershipGuard,
  workspaceRepoEntry,
} from '#/server/modules/workspace-pane-tabs-restore.ts'
import { abortableWorkspaceRestore, workspaceRepoDisplayName } from '#/server/modules/workspace-restore-utils.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

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

  const membership = await confirmServerWorkspaceRepoEntry(entry)
  if (!membership.matched) throw repoNotInWorkspace()
  const initializedTabs = await initializeWorkspacePaneTabsWithMembershipGuard({
    restoreInput: input,
    workspace: membership.workspace,
    repos: [repo],
    confirmMembership: async () => await confirmServerWorkspaceRepoEntry(entry),
    assertCurrent: () => assertCurrentRepoRuntimeMembership(input),
  })
  if (!initializedTabs.matched) throw repoNotInWorkspace()
  return { repo, snapshot: initializedTabs.snapshots[0]?.snapshot ?? null }
}

async function projectWorkspaceRepo(
  input: RestoreRepoTabsInput,
  entry: RepoSessionEntry,
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
      projection,
    }
  }
  const probe = await probeRepo(entry.id)
  assertCurrentRepoRuntimeMembership(input)
  if (!probe.ok || !probe.root || probe.root !== entry.id) return null
  const projection = await readRepoProjection(probe.root, {
    repoRuntimeId: input.repoRuntimeId,
    signal: input.signal,
    mode: 'full',
  })
  assertCurrentRepoRuntimeMembership(input)
  if (!projection.snapshot) return null
  return {
    entry: { kind: 'local', id: probe.root },
    repoRoot: probe.root,
    repoRuntimeId: input.repoRuntimeId,
    name: probe.name ?? workspaceRepoDisplayName(probe.root),
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
