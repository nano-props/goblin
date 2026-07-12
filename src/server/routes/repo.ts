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
  listRepoRuntimes,
  releaseRepoRuntime,
  replaceRepoRuntimeMembershipsForClient,
} from '#/server/modules/repo-runtimes.ts'
import { REPO_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import type { RepoLogResponse } from '#/shared/api-types.ts'
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
  async function readJsonOrThrow<T>(run: () => Promise<T>, label: string): Promise<T> {
    try {
      return await run()
    } catch (err) {
      serverRepoNodeLog.warn({ err, label }, 'failed')
      throw err
    }
  }

  app.post('/probe', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.probe, c)
    return c.json(await jsonOr(() => probeRepo(cwd), READ_REPO_ERROR, 'probe'))
  })
  app.post('/log', async (c) => {
    const { cwd, branch, count, skip } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.log, c)
    return c.json(
      await readJsonOrThrow<RepoLogResponse>(
        () =>
          getRepoLog(cwd, branch, {
            count: count ?? DEFAULT_REPOSITORY_LOG_COUNT,
            skip: skip ?? 0,
            signal: c.req.raw.signal,
          }),
        'log',
      ),
    )
  })
  app.post('/remote-branches', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.getRemoteBranches, c)
    return c.json(await readJsonOrThrow(() => getRepoRemoteBranches(cwd, c.req.raw.signal), 'remote-branches'))
  })
  app.post('/worktree-bootstrap-preview', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.worktreeBootstrapPreview, c)
    return c.json(
      await jsonOr(
        () => getRepoWorktreeBootstrapPreview(cwd, c.req.raw.signal),
        { ok: false as const, message: 'error.failed-read-repo' },
        'worktree-bootstrap-preview',
      ),
    )
  })
  app.post('/patch', async (c) => {
    const { cwd, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.patch, c)
    return c.json(await readJsonOrThrow(() => getRepoPatch(cwd, worktreePath, c.req.raw.signal), 'patch'))
  })
  app.post('/tree', async (c) => {
    const { cwd, worktreePath, prefix } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.tree, c)
    return c.json(
      await readJsonOrThrow(
        // Do not pipe the HTTP request signal into the git tree read.
        // In the Electron/Vite proxy path that signal can abort while
        // React Query is still settling the tab render.
        () => getRepositoryTree(cwd, worktreePath, { prefix }),
        'tree',
      ),
    )
  })
  app.post('/file-viewer', async (c) => {
    const { cwd, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fileViewer, c)
    return c.json(
      await readJsonOrThrow(() => getRepositoryFileViewer(cwd, worktreePath, c.req.raw.signal), 'file-viewer'),
    )
  })
  app.post('/trash-file', async (c) => {
    const { cwd, worktreePath, path } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.trashFile, c)
    const result = await jsonOr(
      () => trashRepositoryFile(cwd, worktreePath, path, c.req.raw.signal),
      { ok: false as const, message: 'error.failed-trash-file' },
      'trash-file',
    )
    if (result.ok || result.repoChanged === true) {
      publishRepoQueryInvalidation({ repoId: cwd, query: 'repo-snapshot' })
    }
    return c.json(result)
  })
  app.post('/projection', async (c) => {
    const { cwd, branch, mode } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.projection, c)
    return c.json(
      await readJsonOrThrow(
        () => readRepoProjection(cwd, { branch, mode: mode ?? 'full', signal: c.req.raw.signal }),
        'projection',
      ),
    )
  })
  app.post('/operations', async (c) => {
    const { cwd, includeSettled } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.operations, c)
    return c.json(await readRepoOperationsSnapshot(cwd, { includeSettled, signal: c.req.raw.signal }))
  })
  app.post('/fetch', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fetch, c)
    return c.json(await jsonOr(() => fetchRepo(cwd, 'user', c.req.raw.signal), READ_REPO_ERROR, 'fetch'))
  })
  app.post('/clone', async (c) => {
    const { url, parentPath, directoryName } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.clone, c)
    return c.json(
      await jsonOr(() => cloneRepo(url, parentPath, directoryName, c.req.raw.signal), READ_REPO_ERROR, 'clone'),
    )
  })
  app.post('/pull', async (c) => {
    const { cwd, branch, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.pull, c)
    return c.json(
      await jsonOr(() => pullRepoBranch(cwd, branch, worktreePath, c.req.raw.signal), READ_REPO_ERROR, 'pull'),
    )
  })
  app.post('/push', async (c) => {
    const { cwd, branch } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.push, c)
    return c.json(await jsonOr(() => pushRepoBranch(cwd, branch, c.req.raw.signal), READ_REPO_ERROR, 'push'))
  })
  app.post('/create-worktree', async (c) => {
    const { cwd, worktreePath, mode, worktreeBootstrap } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.createWorktree, c)
    return c.json(
      await jsonOr(
        () =>
          createRepoWorktree(cwd, { worktreePath, mode }, c.req.raw.signal, {
            worktreeBootstrap,
          }),
        READ_REPO_ERROR,
        'create-worktree',
      ),
    )
  })
  app.post('/delete-branch', async (c) => {
    const { cwd, branch, force, alsoDeleteUpstream } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.deleteBranch, c)
    return c.json(
      await jsonOr(
        () => deleteRepoBranch(cwd, branch, { force, alsoDeleteUpstream }, c.req.raw.signal),
        READ_REPO_ERROR,
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
              ),
          }),
        READ_REPO_ERROR,
        'remove-worktree',
      ),
    )
  })
  app.post('/open-url', async (c) => {
    const { cwd, target } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openUrl, c)
    return c.json(await jsonOr(() => openRepoUrl(cwd, target, c.req.raw.signal), READ_REPO_ERROR, 'open-url'))
  })
  app.post('/open-terminal', async (c) => {
    const { path, app } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openTerminal, c)
    return c.json(await jsonOr(() => openRepoTerminal(path, app), READ_REPO_ERROR, 'open-terminal'))
  })
  app.post('/open-editor', async (c) => {
    const { path, app } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openEditor, c)
    return c.json(await jsonOr(() => openRepoEditor(path, app), READ_REPO_ERROR, 'open-editor'))
  })
  app.post('/open-in-finder', async (c) => {
    const { path } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openInFinder, c)
    return c.json(await jsonOr(() => openRepoInFinder(path), READ_REPO_ERROR, 'open-in-finder'))
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
