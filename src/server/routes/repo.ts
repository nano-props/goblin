import { getBackgroundSyncRepos, setBackgroundSyncRepos } from '#/server/modules/background-sync.ts'
import { serverRepoNodeLog } from '#/node/logger.ts'
import {
  readRepoProjection,
  readRepoWorktreeStatus,
  readRepoOperationsSnapshot,
  getRepoLog,
  getRepoPatch,
  getRepoWorktreeBootstrapPreview,
  probeRepo,
} from '#/server/modules/repo-read-paths.ts'
import { getRepositoryFileViewer } from '#/server/modules/repo-file-viewer.ts'
import { getRepositoryTree } from '#/server/modules/repo-tree.ts'
import { canonicalRuntimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-validators.ts'
import { trashRepositoryFile } from '#/server/modules/repo-tree-trash.ts'
import {
  abortRepoOperation,
  cloneRepo,
  createRepoWorktree,
  deleteRepoBranch,
  fetchRepo,
  getRepoRemoteBranches,
  openRepoEditor,
  openRepoInFinder,
  openRepoTerminal,
  openRepoUrl,
  pullRepoBranch,
  pushRepoBranch,
  removeCapturedRepoWorktree,
} from '#/server/modules/repo-write-paths.ts'
import { getServerFetchIntervalSec } from '#/server/modules/settings-source.ts'
import { publishRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import {
  isCurrentWorkspaceRuntime,
  workspaceRuntimeHasGitCapability,
} from '#/server/modules/workspace-runtimes.ts'
import { REPO_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import { IpcError, type RepoLogResponse } from '#/shared/api-types.ts'
import { isRemoteRepoRuntimeFailure } from '#/server/modules/remote-runtime-failure.ts'
import { settleRemoteRuntimeFailure } from '#/server/modules/remote-runtime-failure-settlement.ts'
import type { ServerWorktreeRemovalHost } from '#/server/worktree-removal/worktree-removal-host.ts'
import type { ServerRepoMutationHost } from '#/server/repo-mutation/repo-mutation-host.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'
import { readWorkspaceDirectoryOverview } from '#/server/modules/workspace-directory-overview.ts'

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
    try {
      return await run()
    } catch (err) {
      if (signal?.aborted) throw err
      if (isRemoteRepoRuntimeFailure(err)) {
        settleRemoteRuntimeFailure(userId, err)
        serverRepoNodeLog.warn({ err, label }, 'failed')
        throw new IpcError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
      }
      serverRepoNodeLog.warn({ err, label }, 'failed')
      throw err
    }
  }
  function assertCurrentWorkspaceRuntimeForRead(
    userId: string | null | undefined,
    repoRoot: string,
    workspaceRuntimeId: string,
  ): asserts userId is string {
    if (!userId || !isCurrentWorkspaceRuntime(userId, repoRoot, workspaceRuntimeId)) {
      throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })
    }
  }
  function assertGitCapability(userId: string, repoRoot: string, workspaceRuntimeId: string): void {
    if (!workspaceRuntimeHasGitCapability(userId, repoRoot, workspaceRuntimeId)) {
      throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-git-unavailable' })
    }
  }

  app.post('/probe', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.probe, c)
    return c.json(await jsonOr(() => probeRepo(cwd), READ_REPO_ERROR, 'probe'))
  })
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
  app.post('/tree', async (c) => {
    const { target, prefix } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.tree, c)
    const executionTarget = canonicalRuntimeWorkspacePaneTarget(target)
    if (!executionTarget || executionTarget.kind === 'git-branch') {
      throw new Error('error.workspace-target-transport-mismatch')
    }
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, executionTarget.workspaceId, executionTarget.workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () =>
          getRepositoryTree(executionTarget, {
            prefix,
            workspaceRuntimeId: executionTarget.workspaceRuntimeId,
            signal: c.req.raw.signal,
          }),
        'tree',
        c.req.raw.signal,
      ),
    )
  })
  app.post('/file-viewer', async (c) => {
    const { cwd, workspaceRuntimeId, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fileViewer, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => getRepositoryFileViewer(cwd, worktreePath, c.req.raw.signal, { workspaceRuntimeId }),
        'file-viewer',
      ),
    )
  })
  app.post('/trash-file', async (c) => {
    const { cwd, workspaceRuntimeId, worktreePath, path } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.trashFile, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, cwd, workspaceRuntimeId)
    const result = await runtimeReadJsonOrThrow(
      userId,
      () => trashRepositoryFile(cwd, worktreePath, path, c.req.raw.signal, { workspaceRuntimeId }),
      'trash-file',
    )
    if (result.ok || result.repositoryStateChanged === true) {
      publishRepoQueryInvalidation({ repoId: cwd, query: 'repo-snapshot' })
    }
    return c.json(result)
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
    return c.json(await readRepoOperationsSnapshot(cwd, { includeSettled, workspaceRuntimeId, signal: c.req.raw.signal }))
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
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => pullRepoBranch(cwd, branch, worktreePath, c.req.raw.signal, { workspaceRuntimeId }),
        'pull',
      ),
    )
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
  app.post('/open-terminal', async (c) => {
    const { repoId, workspaceRuntimeId, worktreePath, app } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openTerminal, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, repoId, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => openRepoTerminal(repoId, worktreePath, app, c.req.raw.signal, { workspaceRuntimeId }),
        'open-terminal',
      ),
    )
  })
  app.post('/open-editor', async (c) => {
    const { repoId, workspaceRuntimeId, worktreePath, app } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openEditor, c)
    const userId = userIdFromContext(c)
    assertCurrentWorkspaceRuntimeForRead(userId, repoId, workspaceRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => openRepoEditor(repoId, worktreePath, app, c.req.raw.signal, { workspaceRuntimeId }),
        'open-editor',
      ),
    )
  })
  app.post('/open-in-finder', async (c) => {
    const { repoId, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openInFinder, c)
    return c.json(await jsonOr(() => openRepoInFinder(repoId, worktreePath), READ_REPO_ERROR, 'open-in-finder'))
  })
  app.post('/background-sync-repos', async (c) => {
    const { repoIds } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.backgroundSyncRepos, c)
    return c.json(
      await jsonOr(
        async () => {
          await setBackgroundSyncRepos(repoIds)
          return { ok: true, repoIds: getBackgroundSyncRepos(), intervalSec: await getServerFetchIntervalSec() }
        },
        { ok: true as const, repoIds: [], intervalSec: 0 },
        'background-sync-repos',
      ),
    )
  })
  app.post('/abort', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.abort, c)
    return c.json(await jsonOr(async () => abortRepoOperation(cwd), false, 'abort'))
  })
  return app
}
