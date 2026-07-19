import {
  beginBackgroundSyncRegistration,
  commitBackgroundSyncRegistration,
  finishBackgroundSyncRegistration,
  getBackgroundSyncRepos,
  prepareBackgroundSync,
} from '#/server/modules/background-sync.ts'
import { serverRepoNodeLog } from '#/node/logger.ts'
import {
  readRepoProjection,
  readRepoWorktreeStatus,
  readRepoOperationsSnapshot,
  getRepoLog,
  getRepoPatch,
  getRepoWorktreeBootstrapPreview,
} from '#/server/modules/repo-read-paths.ts'
import {
  cloneRepo,
  createRepoWorktree,
  deleteRepoBranch,
  fetchRepo,
  getRepoRemoteBranches,
  openRepoUrl,
  pullRepoBranch,
  pushRepoBranch,
  removeCapturedRepoWorktree,
  type RepoFilesystemMutationOutcome,
} from '#/server/modules/repo-write-paths.ts'
import { getServerFetchIntervalSec } from '#/server/modules/settings-source.ts'
import {
  publishRepoQueryInvalidation,
  publishUserWorkspaceFilesystemInvalidation,
} from '#/server/modules/invalidation-broker.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import {
  isCurrentWorkspaceRuntimeMembership,
  workspaceRuntimeClientHasMemberships,
  workspaceRuntimeHasGitCapability,
} from '#/server/modules/workspace-runtimes.ts'
import { REPO_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import { workspaceLocatorForPath, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { IpcError, type RepoLogResponse } from '#/shared/api-types.ts'
import {
  requireCurrentWorkspaceRuntime,
  runGitWorkspaceRuntimeRequest,
} from '#/server/modules/workspace-runtime-request.ts'
import type { ServerWorktreeRemovalHost } from '#/server/worktree-removal/worktree-removal-host.ts'
import type { ServerRepoMutationHost } from '#/server/repo-mutation/repo-mutation-host.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'
import { readWorkspaceDirectoryOverview } from '#/server/modules/workspace-directory-overview.ts'
import { resolveRepoSource } from '#/server/modules/repo-source.ts'

// Soft-fail envelope returned by `jsonOr` for every repo action that
// doesn't have a more specific success shape. Keep this in one place
// so the client sees a stable contract — `err.message` is the
// human-readable i18n key, `err.ok === false` is the branch.
const READ_REPO_ERROR = { ok: false as const, message: 'error.failed-read-repo' }

export function createRepoRoutes(options: {
  worktreeRemovalApplication: ServerWorktreeRemovalHost
  repoMutationApplication: ServerRepoMutationHost
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
}) {
  const app = createRouteApp()
  async function jsonOr<T>(run: () => Promise<T>, fallback: T, label: string) {
    try {
      return await run()
    } catch (err) {
      serverRepoNodeLog.warn({ err, label }, 'failed')
      return fallback
    }
  }
  async function runtimeReadJsonOrThrow<T>(
    userId: string,
    run: () => Promise<T>,
    label: string,
    signal?: AbortSignal,
  ): Promise<T> {
    return await runGitWorkspaceRuntimeRequest({ userId, run, label, signal })
  }
  function assertCurrentWorkspaceRuntimeForRead(
    userId: string | null | undefined,
    repoRoot: WorkspaceId,
    workspaceRuntimeId: string,
  ): asserts userId is string {
    requireCurrentWorkspaceRuntime(userId, repoRoot, workspaceRuntimeId)
  }
  function assertGitCapability(userId: string, repoRoot: WorkspaceId, workspaceRuntimeId: string): void {
    if (!workspaceRuntimeHasGitCapability(userId, repoRoot, workspaceRuntimeId)) {
      throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-git-unavailable' })
    }
  }

  app.post('/log', async (c) => {
    const { cwd, workspaceRuntimeId, branch, count, skip } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.log, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow<RepoLogResponse>(
        userId,
        () =>
          getRepoLog(cwd, branch, {
            count: count ?? DEFAULT_REPOSITORY_LOG_COUNT,
            skip: skip ?? 0,
            signal: c.req.raw.signal,
            workspaceRuntimeId,
          }),
        'log',
      ),
    )
  })
  app.post('/remote-branches', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.getRemoteBranches, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => getRepoRemoteBranches(cwd, { signal: c.req.raw.signal, workspaceRuntimeId }),
        'remote-branches',
      ),
    )
  })
  app.post('/worktree-bootstrap-preview', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.worktreeBootstrapPreview, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => getRepoWorktreeBootstrapPreview(cwd, { signal: c.req.raw.signal, workspaceRuntimeId }),
        'worktree-bootstrap-preview',
      ),
    )
  })
  app.post('/patch', async (c) => {
    const { cwd, workspaceRuntimeId, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.patch, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => getRepoPatch(cwd, worktreePath, { signal: c.req.raw.signal, workspaceRuntimeId }),
        'patch',
      ),
    )
  })
  app.post('/projection', async (c) => {
    const { cwd, workspaceRuntimeId, branch, mode } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.projection, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => readRepoProjection(cwd, { branch, mode: mode ?? 'full', signal: c.req.raw.signal, workspaceRuntimeId }),
        'projection',
      ),
    )
  })
  app.post('/worktree-status', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.worktreeStatus, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => readRepoWorktreeStatus(cwd, { signal: c.req.raw.signal, workspaceRuntimeId }),
        'worktree-status',
      ),
    )
  })
  app.post('/workspace-overview', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.workspaceOverview, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => readWorkspaceDirectoryOverview(cwd, { workspaceRuntimeId, signal: c.req.raw.signal }),
        'workspace-overview',
      ),
    )
  })
  app.post('/operations', async (c) => {
    const { cwd, workspaceRuntimeId, includeSettled } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.operations, c)
    if (cwd && workspaceRuntimeId) {
      const userId = userIdFromContext(c)
      assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
      assertGitCapability(userId, cwd, workspaceRuntimeId)
    }
    return c.json(
      await readRepoOperationsSnapshot(cwd, { includeSettled, workspaceRuntimeId, signal: c.req.raw.signal }),
    )
  })
  app.post('/fetch', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fetch, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(userId, () => fetchRepo(cwd, 'user', c.req.raw.signal, workspaceRuntimeId), 'fetch'),
    )
  })
  app.post('/clone', async (c) => {
    const { url, parentPath, directoryName } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.clone, c)
    return c.json(
      await jsonOr(() => cloneRepo(url, parentPath, directoryName, c.req.raw.signal), READ_REPO_ERROR, 'clone'),
    )
  })
  app.post('/pull', async (c) => {
    const { cwd, workspaceRuntimeId, branch, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.pull, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    const result = await runtimeReadJsonOrThrow(
      userId,
      () => pullRepoBranch(cwd, branch, worktreePath, c.req.raw.signal, { workspaceRuntimeId }),
      'pull',
    )
    return c.json(publishPullFilesystemInvalidations(userId, cwd, workspaceRuntimeId, result))
  })
  app.post('/push', async (c) => {
    const { cwd, workspaceRuntimeId, branch } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.push, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => pushRepoBranch(cwd, branch, c.req.raw.signal, { workspaceRuntimeId }),
        'push',
      ),
    )
  })
  app.post('/create-worktree', async (c) => {
    const { cwd, workspaceRuntimeId, worktreePath, mode, worktreeBootstrap } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.createWorktree,
      c,
    )
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () =>
          createRepoWorktree(cwd, { worktreePath, mode }, c.req.raw.signal, {
            workspaceRuntimeId,
            worktreeBootstrap,
          }),
        'create-worktree',
      ),
    )
  })
  app.post('/delete-branch', async (c) => {
    const { cwd, workspaceRuntimeId, branch, force, deleteUpstream } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.deleteBranch,
      c,
    )
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        async () => {
          return await options.repoMutationApplication.deleteBranch(userId, {
            repoRoot: cwd,
            workspaceRuntimeId,
            branchName: branch,
            deleteBranch: async () =>
              await deleteRepoBranch(cwd, branch, { force, deleteUpstream }, c.req.raw.signal, { workspaceRuntimeId }),
          })
        },
        'delete-branch',
      ),
    )
  })
  app.post('/remove-worktree', async (c) => {
    const { cwd, workspaceRuntimeId, branch, worktreePath, deleteBranch, forceDeleteBranch, deleteUpstream } =
      await parseHttpBody(REPO_PROCEDURE_SCHEMAS.removeWorktree, c)
    const userId = userIdFromContext(c)
    if (!userId) throw new Error('error.unauthorized')
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await jsonOr(
        () =>
          options.worktreeRemovalApplication.removeWorktree(userId, {
            repoRoot: cwd,
            workspaceRuntimeId,
            worktreePath,
            branchName: branch,
            deleteBranch,
            signal: c.req.raw.signal,
            remove: async (
              physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
              lifecycle: RepoWorktreeRemovalLifecycle,
              signal: AbortSignal,
            ) =>
              await removeCapturedRepoWorktree(
                cwd,
                { branch, worktreePath, deleteBranch, forceDeleteBranch, deleteUpstream },
                lifecycle,
                physicalWorktreeCapability,
                signal,
                { workspaceRuntimeId },
              ),
          }),
        READ_REPO_ERROR,
        'remove-worktree',
      ),
    )
  })
  app.post('/open-url', async (c) => {
    const { cwd, workspaceRuntimeId, target } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openUrl, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => openRepoUrl(cwd, target, c.req.raw.signal, { workspaceRuntimeId }),
        'open-url',
      ),
    )
  })
  app.post('/background-sync-repos', async (c) => {
    const { clientId, revision, targets } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.backgroundSyncRepos, c)
    const userId = requiredUserId(userIdFromContext(c))
    if (targets.length === 0 && !workspaceRuntimeClientHasMemberships(userId, clientId)) {
      return c.json(await backgroundSyncResponse(userId))
    }
    for (const target of targets) {
      requireCurrentWorkspaceRuntime(userId, target.workspaceId, target.workspaceRuntimeId)
      requireCurrentWorkspaceRuntimeMembership(userId, clientId, target.workspaceId, target.workspaceRuntimeId)
      assertGitCapability(userId, target.workspaceId, target.workspaceRuntimeId)
    }
    const admission = beginBackgroundSyncRegistration(userId, clientId, revision, targets)
    if (!admission) return c.json(await backgroundSyncResponse(userId))
    const signal = AbortSignal.any([c.req.raw.signal, admission.signal])
    try {
      return c.json(
        await runtimeReadJsonOrThrow(
          userId,
          async () => {
            await prepareBackgroundSync()
            signal.throwIfAborted()
            for (const target of targets) {
              signal.throwIfAborted()
              requireCurrentWorkspaceRuntime(userId, target.workspaceId, target.workspaceRuntimeId)
              requireCurrentWorkspaceRuntimeMembership(userId, clientId, target.workspaceId, target.workspaceRuntimeId)
              assertGitCapability(userId, target.workspaceId, target.workspaceRuntimeId)
              const source = await resolveRepoSource(target.workspaceId, {
                workspaceRuntimeId: target.workspaceRuntimeId,
              })
              const snapshot = await source.getSnapshot(signal)
              signal.throwIfAborted()
              if (snapshot?.remote?.hasRemotes !== true) {
                throw new IpcError({ code: 'BAD_REQUEST', message: 'error.no-remote-url' })
              }
            }
            for (const target of targets) {
              requireCurrentWorkspaceRuntime(userId, target.workspaceId, target.workspaceRuntimeId)
              requireCurrentWorkspaceRuntimeMembership(userId, clientId, target.workspaceId, target.workspaceRuntimeId)
              assertGitCapability(userId, target.workspaceId, target.workspaceRuntimeId)
            }
            signal.throwIfAborted()
            commitBackgroundSyncRegistration(admission)
            return await backgroundSyncResponse(userId)
          },
          'background-sync-repos',
          signal,
        ),
      )
    } finally {
      finishBackgroundSyncRegistration(admission)
    }
  })
  return app
}

function requiredUserId(userId: string | null | undefined): string {
  if (!userId) throw new IpcError({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
  return userId
}

async function backgroundSyncResponse(userId: string) {
  return {
    ok: true as const,
    repoIds: getBackgroundSyncRepos(userId),
    intervalSec: await getServerFetchIntervalSec(),
  }
}

function requireCurrentWorkspaceRuntimeMembership(
  userId: string,
  clientId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): void {
  if (!isCurrentWorkspaceRuntimeMembership(userId, workspaceId, workspaceRuntimeId, clientId)) {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
  }
}

function publishPullFilesystemInvalidations(
  userId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  outcome: RepoFilesystemMutationOutcome,
) {
  const { affectedWorktreePaths = [], ...result } = outcome
  const roots = new Set(
    affectedWorktreePaths
      .map((worktreePath) => workspaceLocatorForPath(workspaceId, worktreePath))
      .filter((root): root is WorkspaceId => root !== null),
  )
  for (const root of roots) {
    publishUserWorkspaceFilesystemInvalidation(userId, {
      target: { kind: 'git-worktree', workspaceId, workspaceRuntimeId, root },
    })
  }
  return result
}
