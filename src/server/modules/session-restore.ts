import PQueue from 'p-queue'
import {
  IpcError,
  isProjectedRestoredWorkspaceRepo,
  type ProjectedRestoredWorkspaceRepoRuntime,
  type RepoWorkspaceTabsRestoreIntent,
  type RepoWorkspaceTabsRestoreResult,
  type RepoRuntimeProjection,
  type RestoredWorkspaceRepoRuntime,
  type WorkspaceRuntimeRestoreSnapshot,
  type ServerWorkspaceState,
} from '#/shared/api-types.ts'
import { repoSessionEntryId, type RemoteRepoSessionEntry, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  parseWorkspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { probeRepo, readRepoProjection } from '#/server/modules/repo-read-paths.ts'
import {
  acquireRepoRuntimeLease,
  isCurrentRepoRuntime,
  releaseRepoRuntimeMembershipLease,
  type RepoRuntimeMembershipLeaseEntry,
} from '#/server/modules/repo-runtimes.ts'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import { getServerWorkspaceState, saveRebuiltServerWorkspaceState } from '#/server/modules/settings-source.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

export interface RestoreServerWorkspaceInput {
  userId: string
  clientId: string
  openRepoEntries: RepoSessionEntry[]
  // The repo the user is currently viewing. Only this repo gets the full
  // projection read + pane-tab restore at cold start. Other repos are
  // validated/canonicalized, then returned as stub leases and restored lazily
  // when the user navigates to them.
  activeRepoRoot?: string | null
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  signal?: AbortSignal
}

export interface RestoredServerWorkspace {
  status: 'restored' | 'repaired'
  openRepoEntries: RepoSessionEntry[]
  workspace: ServerWorkspaceState
  runtime: WorkspaceRuntimeRestoreSnapshot
}

type RestoredServerWorkspaceSnapshot = RestoredServerWorkspace

export interface RestoreRepoTabsInput {
  userId: string
  clientId: string
  repoRoot: string
  repoRuntimeId: string
  intent: RepoWorkspaceTabsRestoreIntent
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  signal?: AbortSignal
}

type OpenSessionRepoResult = { ok: true; opened: OpenedRepoSessionEntry } | { ok: false }
type WorkspaceSessionValidationResult = { ok: true } | { ok: false }

type OpenedRepoSessionEntry = RestoredWorkspaceRepoRuntime & {
  lease: RepoRuntimeMembershipLeaseEntry
}
type OpenedProjectedRepoSessionEntry = ProjectedRestoredWorkspaceRepoRuntime & {
  lease: RepoRuntimeMembershipLeaseEntry
}

interface WorkspacePaneTabsRestoreReplacement {
  repoRoot: string
  repoRuntimeId: string
  target: WorkspacePaneTabsTarget
  tabs: WorkspacePaneTabEntry[]
}

const MAX_REBUILD_CONFLICT_RETRIES = 3
const restoreQueues = new Map<string, PQueue>()

export async function restoreServerWorkspace(input: RestoreServerWorkspaceInput): Promise<RestoredServerWorkspace> {
  input.signal?.throwIfAborted()
  const key = restoreQueueKey(input.userId, input.clientId)
  const queue = restoreQueueFor(key)
  try {
    return await queue.add(async () => {
      input.signal?.throwIfAborted()
      const workspace = await getServerWorkspaceState()
      const restored = await restoreServerWorkspaceSnapshot(
        { ...input, activeRepoRoot: input.activeRepoRoot ?? input.openRepoEntries[0]?.id ?? null },
        { workspace, openRepoEntries: input.openRepoEntries },
        0,
      )
      return restored
    })
  } finally {
    void queue.onIdle().then(() => {
      if (restoreQueues.get(key) === queue && queue.size === 0 && queue.pending === 0) restoreQueues.delete(key)
    })
  }
}

function restoreQueueKey(userId: string, clientId: string): string {
  return `${userId}\0${clientId}`
}

function restoreQueueFor(key: string): PQueue {
  let queue = restoreQueues.get(key)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    restoreQueues.set(key, queue)
  }
  return queue
}

async function restoreServerWorkspaceSnapshot(
  input: RestoreServerWorkspaceInput,
  source: { workspace: ServerWorkspaceState; openRepoEntries: RepoSessionEntry[] },
  conflictRetries: number,
): Promise<RestoredServerWorkspaceSnapshot> {
  input.signal?.throwIfAborted()
  const opened: OpenedRepoSessionEntry[] = []
  let repoRestoreFailed = false
  let openedMembershipsCommitted = false
  const activeRepoRoot = input.activeRepoRoot ?? null
  try {
    for (const entry of source.openRepoEntries) {
      const result = await openSessionRepo(input, entry, {
        active: repoSessionEntryId(entry) === activeRepoRoot,
      })
      if (!result.ok) {
        repoRestoreFailed = true
        continue
      }
      opened.push(result.opened)
    }

    input.signal?.throwIfAborted()
    // Only the active repo's tabs are validated and restored at startup.
    // Non-active repos carry `projection: null` so their `targetForSessionKey`
    // cannot resolve — and their tabs will be restored lazily when the user
    // navigates to them via `restoreRepoTabsForRepo`.
    const openedActive = opened.filter(isOpenedProjectedRepo)
    if (!validateWorkspacePaneTabs(source.workspace, openedActive).ok) {
      const saved = await saveRebuiltServerWorkspaceState({
        persistedSnapshot: source.workspace,
        rebuiltWorkspace: workspaceWithoutRepoTabs(source.workspace, openedActive[0]?.repoRoot),
      })
      if (saved.saved) {
        openedMembershipsCommitted = true
        return {
          status: 'repaired',
          openRepoEntries: opened.map((repo) => repo.entry),
          workspace: saved.workspace,
          runtime: runtimeSnapshotFromOpened(opened, activeRepoRootForOpened(input.activeRepoRoot, opened), []),
        }
      }
      if (conflictRetries >= MAX_REBUILD_CONFLICT_RETRIES) {
        throw new Error('workspace session restore was superseded too many times')
      }
      return await restoreServerWorkspaceSnapshot(
        input,
        { workspace: saved.latestWorkspace, openRepoEntries: source.openRepoEntries },
        conflictRetries + 1,
      )
    }

    input.signal?.throwIfAborted()
    const workspacePaneTabs = await restoreWorkspacePaneTabsForRepos(input, source.workspace, openedActive)
    input.signal?.throwIfAborted()
    openedMembershipsCommitted = true
    return {
      status: repoRestoreFailed ? 'repaired' : 'restored',
      openRepoEntries: opened.map((repo) => repo.entry),
      workspace: source.workspace,
      runtime: runtimeSnapshotFromOpened(
        opened,
        activeRepoRootForOpened(input.activeRepoRoot, opened),
        workspacePaneTabs,
      ),
    }
  } finally {
    if (!openedMembershipsCommitted) releaseOpenedRepoRuntimes(input, opened)
  }
}

function workspaceWithoutRepoTabs(workspace: ServerWorkspaceState, repoRoot: string | undefined): ServerWorkspaceState {
  if (!repoRoot) return workspace
  const workspacePaneTabsByTargetByRepo = { ...workspace.workspacePaneTabsByTargetByRepo }
  delete workspacePaneTabsByTargetByRepo[repoRoot]
  return { workspacePaneTabsByTargetByRepo }
}

async function openSessionRepo(
  input: RestoreServerWorkspaceInput,
  entry: RepoSessionEntry,
  options: { active: boolean },
): Promise<OpenSessionRepoResult> {
  input.signal?.throwIfAborted()
  if (entry.kind === 'remote') return await openRemoteSessionRepo(input, entry, options)
  const probe = await probeRepo(entry.id)
  if (!probe.ok || !probe.root) return { ok: false }
  if (probe.root !== entry.id) return { ok: false }
  const lease = acquireRepoRuntimeLease(input.userId, probe.root, input.clientId)
  if (!options.active) {
    // Stub path: validated lease only. No projection read or pane-tab restore.
    // Persisted local entries must already be canonical; this branch refuses to
    // migrate non-canonical paths and lets the session rebuild path clean them.
    return {
      ok: true,
      opened: {
        entry: { kind: 'local', id: probe.root },
        repoRoot: probe.root,
        repoRuntimeId: lease.repoRuntimeId,
        name: probe.name ?? lastPathSegment(probe.root),
        projection: null,
        lease,
      },
    }
  }
  try {
    const projection = await readRepoProjection(probe.root, {
      repoRuntimeId: lease.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    if (!projection.snapshot) {
      releaseSessionRepoRuntime(input, lease)
      return { ok: false }
    }
    return {
      ok: true,
      opened: {
        entry: { kind: 'local', id: probe.root },
        repoRoot: probe.root,
        repoRuntimeId: lease.repoRuntimeId,
        name: probe.name ?? lastPathSegment(probe.root),
        projection,
        lease,
      },
    }
  } catch (err) {
    releaseSessionRepoRuntime(input, lease)
    throw err
  }
}

async function openRemoteSessionRepo(
  input: RestoreServerWorkspaceInput,
  entry: RemoteRepoSessionEntry,
  options: { active: boolean },
): Promise<OpenSessionRepoResult> {
  const lease = acquireRepoRuntimeLease(input.userId, entry.id, input.clientId)
  if (!options.active) {
    // Stub path for remote repos: still need a name but no lifecycle / projection.
    return {
      ok: true,
      opened: {
        entry,
        repoRoot: entry.id,
        repoRuntimeId: lease.repoRuntimeId,
        name: entry.ref.displayName,
        projection: null,
        lease,
      },
    }
  }
  try {
    const lifecycle = await abortable(
      runRemoteLifecycleWrite({
        userId: input.userId,
        repoId: entry.id,
        repoRuntimeId: lease.repoRuntimeId,
        mode: 'ensure',
      }),
      input.signal,
    )
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') {
      releaseSessionRepoRuntime(input, lease)
      return { ok: false }
    }
    const projection = await readRepoProjection(entry.id, {
      repoRuntimeId: lease.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    if (!projection.snapshot) {
      releaseSessionRepoRuntime(input, lease)
      return { ok: false }
    }
    return {
      ok: true,
      opened: {
        entry,
        repoRoot: entry.id,
        repoRuntimeId: lease.repoRuntimeId,
        name: lifecycle.name,
        target: lifecycle.lifecycle.target,
        projection,
        lease,
      },
    }
  } catch (err) {
    releaseSessionRepoRuntime(input, lease)
    throw err
  }
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise
  signal.throwIfAborted()
  let onAbort: (() => void) | null = null
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('workspace session restore aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function validateWorkspacePaneTabs(
  workspace: ServerWorkspaceState,
  opened: ProjectedRestoredWorkspaceRepoRuntime[],
): WorkspaceSessionValidationResult {
  const openedByRoot = openedRepoByRoot(opened)
  for (const [repoRoot, tabsByTarget] of Object.entries(workspace.workspacePaneTabsByTargetByRepo)) {
    const repo = openedByRoot.get(repoRoot)
    // Stub leases (non-active repos at cold start) carry `projection: null`
    // and their tabs will be restored lazily. Defer validation to the lazy
    // path; do not force a session rebuild.
    if (!repo) continue
    for (const targetKey of Object.keys(tabsByTarget)) {
      if (!targetForSessionKey(repo, targetKey)) return { ok: false }
    }
  }
  return { ok: true }
}

/**
 * Restore pane tabs for a single repo on demand (lazy restore from
 * `useRestoreRepoTabsOnView` when the user navigates to a stub repo).
 *
 * Returns the same snapshot shape as the per-repo entry in
 * `WorkspaceRuntimeRestoreSnapshot.workspacePaneTabs`, plus the
 * restored repo (with projection) so the caller can hydrate the store.
 */
export async function restoreRepoTabsForRepo(input: RestoreRepoTabsInput): Promise<RepoWorkspaceTabsRestoreResult> {
  input.signal?.throwIfAborted()
  assertCurrentRepoRuntime(input)
  const entry = input.intent.entry
  if (repoSessionEntryId(entry) !== input.repoRoot) {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.invalid-arguments' })
  }
  const workspace = deferredRepoRestoreWorkspace(input.repoRoot, input.intent)

  const repo = await projectSessionRepo(input, entry)
  if (!repo) {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
  }

  if (!validateWorkspacePaneTabs(workspace, [repo]).ok) {
    return { repo, snapshot: null }
  }

  const snapshots = await restoreWorkspacePaneTabsForRepos(
    {
      userId: input.userId,
      clientId: input.clientId,
      openRepoEntries: [],
      workspacePaneTabsHost: input.workspacePaneTabsHost,
      signal: input.signal,
    },
    workspace,
    [repo],
  )
  assertCurrentRepoRuntime(input)
  return {
    repo,
    snapshot: snapshots[0]?.snapshot ?? null,
  }
}

function deferredRepoRestoreWorkspace(repoRoot: string, intent: RepoWorkspaceTabsRestoreIntent): ServerWorkspaceState {
  return {
    workspacePaneTabsByTargetByRepo: { [repoRoot]: intent.workspacePaneTabsByTarget },
  }
}

async function projectSessionRepo(
  input: RestoreRepoTabsInput,
  entry: RepoSessionEntry,
): Promise<ProjectedRestoredWorkspaceRepoRuntime | null> {
  if (entry.kind === 'remote') {
    const lifecycle = await abortable(
      runRemoteLifecycleWrite({
        userId: input.userId,
        repoId: entry.id,
        repoRuntimeId: input.repoRuntimeId,
        mode: 'ensure',
      }),
      input.signal,
    )
    assertCurrentRepoRuntime(input)
    if (lifecycle.kind !== 'settled' || lifecycle.lifecycle.kind !== 'ready') return null
    const projection = await readRepoProjection(entry.id, {
      repoRuntimeId: input.repoRuntimeId,
      signal: input.signal,
      mode: 'full',
    })
    assertCurrentRepoRuntime(input)
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
  assertCurrentRepoRuntime(input)
  if (!probe.ok || !probe.root || probe.root !== entry.id) return null
  const projection = await readRepoProjection(probe.root, {
    repoRuntimeId: input.repoRuntimeId,
    signal: input.signal,
    mode: 'full',
  })
  assertCurrentRepoRuntime(input)
  if (!projection.snapshot) return null
  return {
    entry: { kind: 'local', id: probe.root },
    repoRoot: probe.root,
    repoRuntimeId: input.repoRuntimeId,
    name: probe.name ?? lastPathSegment(probe.root),
    projection,
  }
}

function assertCurrentRepoRuntime(input: RestoreRepoTabsInput): void {
  if (isCurrentRepoRuntime(input.userId, input.repoRoot, input.repoRuntimeId)) return
  throw new IpcError({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
}

function isOpenedProjectedRepo(repo: OpenedRepoSessionEntry): repo is OpenedProjectedRepoSessionEntry {
  return isProjectedRestoredWorkspaceRepo(repo)
}

async function restoreWorkspacePaneTabsForRepos(
  input: RestoreServerWorkspaceInput,
  workspace: ServerWorkspaceState,
  opened: ProjectedRestoredWorkspaceRepoRuntime[],
): Promise<Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>> {
  const replacements = workspacePaneTabRestoreReplacements(workspace, opened)
  if (replacements.length === 0) return []
  input.signal?.throwIfAborted()
  if (input.workspacePaneTabsHost.replaceTabsBatch) {
    return await input.workspacePaneTabsHost.replaceTabsBatch(input.clientId, input.userId, {
      replacements: replacements.map((replacement) => ({
        repoRoot: replacement.repoRoot,
        repoRuntimeId: replacement.repoRuntimeId,
        branchName: replacement.target.branchName,
        worktreePath: replacement.target.worktreePath,
        tabs: replacement.tabs,
      })),
    })
  }
  const snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }> = []
  for (const replacement of replacements) {
    input.signal?.throwIfAborted()
    const snapshot = await input.workspacePaneTabsHost.replaceTabs(input.clientId, input.userId, {
      repoRoot: replacement.repoRoot,
      repoRuntimeId: replacement.repoRuntimeId,
      branchName: replacement.target.branchName,
      worktreePath: replacement.target.worktreePath,
      tabs: replacement.tabs,
    })
    upsertWorkspacePaneTabsSnapshot(snapshots, replacement.repoRoot, replacement.repoRuntimeId, snapshot)
  }
  return snapshots
}

function workspacePaneTabRestoreReplacements(
  workspace: ServerWorkspaceState,
  opened: ProjectedRestoredWorkspaceRepoRuntime[],
): WorkspacePaneTabsRestoreReplacement[] {
  const openedByRoot = openedRepoByRoot(opened)
  const replacements: WorkspacePaneTabsRestoreReplacement[] = []
  for (const [repoRoot, tabsByTarget] of Object.entries(workspace.workspacePaneTabsByTargetByRepo)) {
    const repo = openedByRoot.get(repoRoot)
    if (!repo) continue
    for (const [targetKey, tabs] of Object.entries(tabsByTarget)) {
      const target = targetForSessionKey(repo, targetKey)
      if (!target) continue
      replacements.push({ repoRoot: repo.repoRoot, repoRuntimeId: repo.repoRuntimeId, target, tabs })
    }
  }
  return replacements
}

function upsertWorkspacePaneTabsSnapshot(
  snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>,
  repoRoot: string,
  repoRuntimeId: string,
  snapshot: WorkspacePaneTabsSnapshot,
): void {
  const index = snapshots.findIndex((entry) => entry.repoRoot === repoRoot && entry.repoRuntimeId === repoRuntimeId)
  const entry = { repoRoot, repoRuntimeId, snapshot }
  if (index === -1) snapshots.push(entry)
  else snapshots[index] = entry
}

function targetForSessionKey(
  repo: ProjectedRestoredWorkspaceRepoRuntime,
  targetKey: string,
): WorkspacePaneTabsTarget | null {
  if (!repo.projection.snapshot) return null
  const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
  if (!target || target.repoRoot !== repo.repoRoot) return null
  const branches = repo.projection.snapshot.branches
  if (target.kind === 'branch') {
    return branches.some((branch) => branch.name === target.branchName)
      ? { repoRoot: repo.repoRoot, branchName: target.branchName, worktreePath: null }
      : null
  }
  const branch = branches.find((candidate) => candidate.worktree?.path === target.worktreePath)
  return branch ? { repoRoot: repo.repoRoot, branchName: branch.name, worktreePath: target.worktreePath } : null
}

function activeRepoRootForOpened(
  activeRepoRoot: string | null | undefined,
  opened: OpenedRepoSessionEntry[],
): string | null {
  if (activeRepoRoot && opened.some((repo) => repo.repoRoot === activeRepoRoot)) return activeRepoRoot
  return opened[0]?.repoRoot ?? null
}

function openedRepoByRoot<T extends RestoredWorkspaceRepoRuntime>(opened: T[]): Map<string, T> {
  return new Map(opened.map((repo) => [repo.repoRoot, repo]))
}

function runtimeSnapshotFromOpened(
  opened: OpenedRepoSessionEntry[],
  restoredRepoId: string | null,
  workspacePaneTabs: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>,
): WorkspaceRuntimeRestoreSnapshot {
  return {
    repos: opened.map(({ lease: _lease, ...repo }) => repo),
    workspacePaneTabs,
    restoredRepoId,
  }
}

function releaseOpenedRepoRuntimes(input: RestoreServerWorkspaceInput, opened: OpenedRepoSessionEntry[]): void {
  for (const repo of opened) releaseSessionRepoRuntime(input, repo.lease)
}

function releaseSessionRepoRuntime(input: RestoreServerWorkspaceInput, lease: RepoRuntimeMembershipLeaseEntry): void {
  releaseRepoRuntimeMembershipLease(input.userId, input.clientId, lease)
}

function lastPathSegment(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '')
  const segment = trimmed.split(/[\\/]/).pop()
  return segment || value
}

export type { WorkspacePaneTabsSnapshot }
