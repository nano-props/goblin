import {
  beginBackgroundSyncRegistration,
  commitBackgroundSyncRegistration,
  finishBackgroundSyncRegistration,
  getBackgroundSyncRepos,
  prepareBackgroundSync,
} from '#/server/modules/background-sync.ts'
import {
  readRepoPullRequests,
  readRepoSnapshot,
  readRepoWorktreeStatus,
  readRepoOperationsSnapshot,
  getRepoLog,
  getRepoPatch,
  getRepoWorktreeBootstrapPreview,
} from '#/server/modules/repo-read-paths.ts'
import {
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
import { cloneRepo } from '#/server/modules/repo-clone-write.ts'
import { getServerFetchIntervalSec } from '#/server/modules/settings-source.ts'
import {
  publishRepoReadInvalidation,
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
import type { RepoLogResponse } from '#/shared/api-types.ts'
import { IpcError } from '#/shared/ipc-error.ts'
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
import { resolveRepoSource } from '#/server/modules/repo-source.ts'

export function createRepoRoutes(options: {
  worktreeRemovalApplication: ServerWorktreeRemovalHost
  repoMutationApplication: ServerRepoMutationHost
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
}) {
  const app = createRouteApp()
  function assertGitCapability(userId: string, repoRoot: WorkspaceId, workspaceRuntimeId: string): void {
    if (!workspaceRuntimeHasGitCapability(userId, repoRoot, workspaceRuntimeId)) {
      throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-git-unavailable' })
    }
  }
  app.post('/log', async (c) => {
    const { cwd, workspaceRuntimeId, branch, count, skip } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.log, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest<RepoLogResponse>({
        userId,
        run: () =>
          getRepoLog(cwd, branch, {
            count: count ?? DEFAULT_REPOSITORY_LOG_COUNT,
            skip: skip ?? 0,
            signal: c.req.raw.signal,
            workspaceRuntimeId,
          }),
        label: 'log',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/remote-branches', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.getRemoteBranches, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () => getRepoRemoteBranches(cwd, { signal: c.req.raw.signal, workspaceRuntimeId }),
        label: 'remote-branches',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/worktree-bootstrap-preview', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.worktreeBootstrapPreview, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () => getRepoWorktreeBootstrapPreview(cwd, { signal: c.req.raw.signal, workspaceRuntimeId }),
        label: 'worktree-bootstrap-preview',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/patch', async (c) => {
    const { cwd, workspaceRuntimeId, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.patch, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () => getRepoPatch(cwd, worktreePath, { signal: c.req.raw.signal, workspaceRuntimeId }),
        label: 'patch',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/snapshot', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.snapshot, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () => readRepoSnapshot(cwd, { signal: c.req.raw.signal, workspaceRuntimeId }),
        label: 'snapshot',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/pull-requests', async (c) => {
    const { cwd, workspaceRuntimeId, scope } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.pullRequests, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () => readRepoPullRequests(cwd, scope, { signal: c.req.raw.signal, workspaceRuntimeId }),
        label: 'pull-requests',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/worktree-status', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.worktreeStatus, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () => readRepoWorktreeStatus(cwd, { signal: c.req.raw.signal, workspaceRuntimeId }),
        label: 'worktree-status',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/operations', async (c) => {
    const input = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.operations, c)
    if ('cwd' in input) {
      const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), input.cwd, input.workspaceRuntimeId)
      assertGitCapability(userId, input.cwd, input.workspaceRuntimeId)
      return c.json(
        await runGitWorkspaceRuntimeRequest({
          userId,
          run: () =>
            readRepoOperationsSnapshot(input.cwd, {
              includeSettled: input.includeSettled,
              workspaceRuntimeId: input.workspaceRuntimeId,
              signal: c.req.raw.signal,
            }),
          label: 'operations',
          signal: c.req.raw.signal,
        }),
      )
    }
    return c.json(
      await readRepoOperationsSnapshot(undefined, {
        includeSettled: input.includeSettled,
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/fetch', async (c) => {
    const { cwd, workspaceRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fetch, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () => fetchRepo(cwd, 'user', c.req.raw.signal, workspaceRuntimeId),
        label: 'fetch',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/clone', async (c) => {
    const { url, parentPath, directoryName } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.clone, c)
    return c.json(await cloneRepo(url, parentPath, directoryName, c.req.raw.signal))
  })
  app.post('/pull', async (c) => {
    const { cwd, workspaceRuntimeId, branch, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.pull, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    const result = await runGitWorkspaceRuntimeRequest({
      userId,
      run: () => pullRepoBranch(cwd, branch, worktreePath, c.req.raw.signal, { workspaceRuntimeId }),
      label: 'pull',
      signal: c.req.raw.signal,
    })
    return c.json(publishPullFilesystemInvalidations(userId, cwd, workspaceRuntimeId, result))
  })
  app.post('/push', async (c) => {
    const { cwd, workspaceRuntimeId, branch } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.push, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () => pushRepoBranch(cwd, branch, c.req.raw.signal, { workspaceRuntimeId }),
        label: 'push',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/create-worktree', async (c) => {
    const { cwd, workspaceRuntimeId, worktreePath, mode, worktreeBootstrap } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.createWorktree,
      c,
    )
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () =>
          createRepoWorktree(cwd, { worktreePath, mode }, c.req.raw.signal, {
            workspaceRuntimeId,
            worktreeBootstrap,
          }),
        label: 'create-worktree',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/delete-branch', async (c) => {
    const { cwd, workspaceRuntimeId, branch, force, deleteUpstream } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.deleteBranch,
      c,
    )
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: async () => {
          return await options.repoMutationApplication.deleteBranch(userId, {
            repoRoot: cwd,
            workspaceRuntimeId,
            branchName: branch,
            deleteBranch: async () =>
              await deleteRepoBranch(cwd, branch, { force, deleteUpstream }, c.req.raw.signal, { workspaceRuntimeId }),
          })
        },
        label: 'delete-branch',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/remove-worktree', async (c) => {
    const { cwd, workspaceRuntimeId, branch, worktreePath, deleteBranch, forceDeleteBranch, deleteUpstream } =
      await parseHttpBody(REPO_PROCEDURE_SCHEMAS.removeWorktree, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () =>
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
        label: 'remove-worktree',
        signal: c.req.raw.signal,
      }),
    )
  })
  app.post('/open-url', async (c) => {
    const { cwd, workspaceRuntimeId, target } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openUrl, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), cwd, workspaceRuntimeId)
    assertGitCapability(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runGitWorkspaceRuntimeRequest({
        userId,
        run: () => openRepoUrl(cwd, target, c.req.raw.signal, { workspaceRuntimeId }),
        label: 'open-url',
        signal: c.req.raw.signal,
      }),
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
        await runGitWorkspaceRuntimeRequest({
          userId,
          run: async () => {
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
              if (snapshot?.remote.hasRemotes !== true) {
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
          label: 'background-sync-repos',
          signal,
        }),
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
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })
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
