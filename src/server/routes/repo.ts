import { getBackgroundSyncRepos, setBackgroundSyncRepos } from '#/server/modules/background-sync.ts'
import { serverRepoNodeLog } from '#/node/logger.ts'
import {
  readRepoProjection,
  readRepoOperationsSnapshot,
  getRepoLog,
  getRepoPatch,
  getRepoWorktreeBootstrapPreview,
  probeRepo,
} from '#/server/modules/repo-read-paths.ts'
import { getRepositoryFileViewer } from '#/server/modules/repo-file-viewer.ts'
import { getRepositoryTree } from '#/server/modules/repo-tree.ts'
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
  acquireRepoRuntime,
  isCurrentRepoRuntime,
  listRepoRuntimes,
  releaseRepoRuntime,
  replaceRepoRuntimeMembershipsForClient,
} from '#/server/modules/repo-runtimes.ts'
import { REPO_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import { IpcError, type RepoLogResponse } from '#/shared/api-types.ts'
import { isRemoteRepoRuntimeFailure } from '#/server/modules/remote-runtime-failure.ts'
import { settleRemoteRuntimeFailure } from '#/server/modules/remote-runtime-failure-settlement.ts'
import type { ServerWorktreeRemovalHost } from '#/server/worktree-removal/worktree-removal-host.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import type { PhysicalWorktreeCapability } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'

// Soft-fail envelope returned by `jsonOr` for every repo action that
// doesn't have a more specific success shape. Keep this in one place
// so the client sees a stable contract — `err.message` is the
// human-readable i18n key, `err.ok === false` is the branch.
const READ_REPO_ERROR = { ok: false as const, message: 'error.failed-read-repo' }

export function createRepoRoutes(options: { worktreeRemovalApplication: ServerWorktreeRemovalHost }) {
  const app = createRouteApp()
  async function jsonOr<T>(run: () => Promise<T>, fallback: T, label: string) {
    try {
      return await run()
    } catch (err) {
      serverRepoNodeLog.warn({ err, label }, 'failed')
      return fallback
    }
  }
  async function runtimeReadJsonOrThrow<T>(userId: string, run: () => Promise<T>, label: string): Promise<T> {
    try {
      return await run()
    } catch (err) {
      if (isRemoteRepoRuntimeFailure(err)) {
        settleRemoteRuntimeFailure(userId, err)
        serverRepoNodeLog.warn({ err, label }, 'failed')
        throw new IpcError({ code: 'BAD_REQUEST', message: 'error.failed-read-repo' })
      }
      serverRepoNodeLog.warn({ err, label }, 'failed')
      throw err
    }
  }
  function assertCurrentRepoRuntimeForRead(
    userId: string | null | undefined,
    repoRoot: string,
    repoRuntimeId: string,
  ): asserts userId is string {
    if (!userId || !isCurrentRepoRuntime(userId, repoRoot, repoRuntimeId)) {
      throw new IpcError({ code: 'BAD_REQUEST', message: 'error.repo-runtime-stale' })
    }
  }

  app.post('/probe', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.probe, c)
    return c.json(await jsonOr(() => probeRepo(cwd), READ_REPO_ERROR, 'probe'))
  })
  app.post('/log', async (c) => {
    const { cwd, repoRuntimeId, branch, count, skip } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.log, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow<RepoLogResponse>(
        userId,
        () =>
          getRepoLog(cwd, branch, {
            count: count ?? DEFAULT_REPOSITORY_LOG_COUNT,
            skip: skip ?? 0,
            signal: c.req.raw.signal,
            repoRuntimeId,
          }),
        'log',
      ),
    )
  })
  app.post('/remote-branches', async (c) => {
    const { cwd, repoRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.getRemoteBranches, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => getRepoRemoteBranches(cwd, { signal: c.req.raw.signal, repoRuntimeId }),
        'remote-branches',
      ),
    )
  })
  app.post('/worktree-bootstrap-preview', async (c) => {
    const { cwd, repoRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.worktreeBootstrapPreview, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => getRepoWorktreeBootstrapPreview(cwd, { signal: c.req.raw.signal, repoRuntimeId }),
        'worktree-bootstrap-preview',
      ),
    )
  })
  app.post('/patch', async (c) => {
    const { cwd, repoRuntimeId, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.patch, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => getRepoPatch(cwd, worktreePath, { signal: c.req.raw.signal, repoRuntimeId }),
        'patch',
      ),
    )
  })
  app.post('/tree', async (c) => {
    const { cwd, repoRuntimeId, worktreePath, prefix } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.tree, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        // Do not pipe the HTTP request signal into the git tree read.
        // In the Electron/Vite proxy path that signal can abort while
        // React Query is still settling the tab render.
        () => getRepositoryTree(cwd, worktreePath, { prefix, repoRuntimeId }),
        'tree',
      ),
    )
  })
  app.post('/file-viewer', async (c) => {
    const { cwd, repoRuntimeId, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fileViewer, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => getRepositoryFileViewer(cwd, worktreePath, c.req.raw.signal, { repoRuntimeId }),
        'file-viewer',
      ),
    )
  })
  app.post('/trash-file', async (c) => {
    const { cwd, repoRuntimeId, worktreePath, path } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.trashFile, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    const result = await runtimeReadJsonOrThrow(
      userId,
      () => trashRepositoryFile(cwd, worktreePath, path, c.req.raw.signal, { repoRuntimeId }),
      'trash-file',
    )
    if (result.ok || result.repoChanged === true) {
      publishRepoQueryInvalidation({ repoId: cwd, query: 'repo-snapshot' })
    }
    return c.json(result)
  })
  app.post('/projection', async (c) => {
    const { cwd, repoRuntimeId, branch, mode } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.projection, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => readRepoProjection(cwd, { branch, mode: mode ?? 'full', signal: c.req.raw.signal, repoRuntimeId }),
        'projection',
      ),
    )
  })
  app.post('/operations', async (c) => {
    const { cwd, repoRuntimeId, includeSettled } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.operations, c)
    if (cwd && repoRuntimeId) assertCurrentRepoRuntimeForRead(userIdFromContext(c), cwd, repoRuntimeId)
    return c.json(await readRepoOperationsSnapshot(cwd, { includeSettled, repoRuntimeId, signal: c.req.raw.signal }))
  })
  app.post('/fetch', async (c) => {
    const { cwd, repoRuntimeId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fetch, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(userId, () => fetchRepo(cwd, 'user', c.req.raw.signal, repoRuntimeId), 'fetch'),
    )
  })
  app.post('/clone', async (c) => {
    const { url, parentPath, directoryName } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.clone, c)
    return c.json(
      await jsonOr(() => cloneRepo(url, parentPath, directoryName, c.req.raw.signal), READ_REPO_ERROR, 'clone'),
    )
  })
  app.post('/pull', async (c) => {
    const { cwd, repoRuntimeId, branch, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.pull, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => pullRepoBranch(cwd, branch, worktreePath, c.req.raw.signal, { repoRuntimeId }),
        'pull',
      ),
    )
  })
  app.post('/push', async (c) => {
    const { cwd, repoRuntimeId, branch } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.push, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => pushRepoBranch(cwd, branch, c.req.raw.signal, { repoRuntimeId }),
        'push',
      ),
    )
  })
  app.post('/create-worktree', async (c) => {
    const { cwd, repoRuntimeId, worktreePath, mode, worktreeBootstrap } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.createWorktree,
      c,
    )
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () =>
          createRepoWorktree(cwd, { worktreePath, mode }, c.req.raw.signal, {
            repoRuntimeId,
            worktreeBootstrap,
          }),
        'create-worktree',
      ),
    )
  })
  app.post('/delete-branch', async (c) => {
    const { cwd, repoRuntimeId, branch, force, alsoDeleteUpstream } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.deleteBranch,
      c,
    )
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => deleteRepoBranch(cwd, branch, { force, alsoDeleteUpstream }, c.req.raw.signal, { repoRuntimeId }),
        'delete-branch',
      ),
    )
  })
  app.post('/remove-worktree', async (c) => {
    const { cwd, repoRuntimeId, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream } =
      await parseHttpBody(REPO_PROCEDURE_SCHEMAS.removeWorktree, c)
    const userId = userIdFromContext(c)
    if (!userId) throw new Error('error.unauthorized')
    return c.json(
      await jsonOr(
        () =>
          options.worktreeRemovalApplication.removeWorktree(userId, {
            repoRoot: cwd,
            repoRuntimeId,
            worktreePath,
            signal: c.req.raw.signal,
            remove: async (
              physicalWorktreeCapability: PhysicalWorktreeCapability,
              lifecycle: RepoWorktreeRemovalLifecycle,
              signal: AbortSignal,
            ) =>
              await removeCapturedRepoWorktree(
                cwd,
                { branch, worktreePath, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream },
                lifecycle,
                physicalWorktreeCapability,
                signal,
                { repoRuntimeId },
              ),
          }),
        READ_REPO_ERROR,
        'remove-worktree',
      ),
    )
  })
  app.post('/open-url', async (c) => {
    const { cwd, repoRuntimeId, target } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openUrl, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, cwd, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => openRepoUrl(cwd, target, c.req.raw.signal, { repoRuntimeId }),
        'open-url',
      ),
    )
  })
  app.post('/open-terminal', async (c) => {
    const { repoId, repoRuntimeId, worktreePath, app } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openTerminal, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, repoId, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => openRepoTerminal(repoId, worktreePath, app, c.req.raw.signal, { repoRuntimeId }),
        'open-terminal',
      ),
    )
  })
  app.post('/open-editor', async (c) => {
    const { repoId, repoRuntimeId, worktreePath, app } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openEditor, c)
    const userId = userIdFromContext(c)
    assertCurrentRepoRuntimeForRead(userId, repoId, repoRuntimeId)
    return c.json(
      await runtimeReadJsonOrThrow(
        userId,
        () => openRepoEditor(repoId, worktreePath, app, c.req.raw.signal, { repoRuntimeId }),
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
  app.post('/runtime-open', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const input = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.runtimeOpen, c)
    if ('repoInput' in input) {
      const probe = await jsonOr(() => probeRepo(input.repoInput), READ_REPO_ERROR, 'runtime-open')
      if (!probe.ok || !probe.root) {
        return c.json({
          ok: false as const,
          input: input.repoInput,
          reason: probe.message ?? 'error.not-git-repo',
        })
      }
      const repo = { id: probe.root, name: probe.name ?? probe.root.split('/').filter(Boolean).at(-1) ?? probe.root }
      return c.json({
        ok: true as const,
        repo,
        repoRuntimeId: acquireRepoRuntime(userId, repo.id, input.clientId),
      })
    }
    return c.json({ ok: true as const, repoRuntimeId: acquireRepoRuntime(userId, input.repoRoot, input.clientId) })
  })
  app.post('/runtime-list', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    await parseHttpBody(REPO_PROCEDURE_SCHEMAS.runtimeList, c)
    return c.json({ runtimes: listRepoRuntimes(userId) })
  })
  app.post('/runtime-reconcile', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { clientId, repoRoots } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.runtimeReconcile, c)
    return c.json({ runtimes: replaceRepoRuntimeMembershipsForClient(userId, clientId, repoRoots) })
  })
  app.post('/runtime-close', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { repoRoot, repoRuntimeId, clientId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.runtimeClose, c)
    return c.json({ ok: true as const, ...releaseRepoRuntime(userId, repoRoot, repoRuntimeId, clientId) })
  })
  app.post('/abort', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.abort, c)
    return c.json(await jsonOr(async () => abortRepoOperation(cwd), false, 'abort'))
  })
  return app
}
