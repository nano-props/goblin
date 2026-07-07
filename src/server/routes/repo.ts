import { getBackgroundSyncRepos, setBackgroundSyncRepos } from '#/server/modules/background-sync.ts'
import { serverRepoNodeLog } from '#/node/logger.ts'
import {
  readRepoBulk,
  getRepoLog,
  getRepoPatch,
  getRepoPullRequests,
  getRepoSnapshot,
  getRepoStatus,
  getRepoWorktreeBootstrapPreview,
  probeRepo,
} from '#/server/modules/repo-read-paths.ts'
import { getRepositoryFileViewer } from '#/server/modules/repo-file-viewer.ts'
import { getRepositoryTree } from '#/server/modules/repo-tree.ts'
import { trashRepositoryFile } from '#/server/modules/repo-tree-trash.ts'
import {
  abortCloneOperation,
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
  removeRepoWorktree,
} from '#/server/modules/repo-write-paths.ts'
import { getServerFetchIntervalSec } from '#/server/modules/settings-source.ts'
import { publishRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import {
  closeRepoRuntimeInstance,
  getOrOpenRepoRuntimeInstance,
  listRepoRuntimeInstances,
  openRepoRuntimeInstance,
} from '#/server/modules/repo-runtime-instances.ts'
import { REPO_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import type { RepoLogResponse } from '#/shared/api-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'

// Soft-fail envelope returned by `jsonOr` for every repo action that
// doesn't have a more specific success shape. Keep this in one place
// so the client sees a stable contract — `err.message` is the
// human-readable i18n key, `err.ok === false` is the branch.
const READ_REPO_ERROR = { ok: false as const, message: 'error.failed-read-repo' }

export function createRepoRoutes() {
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
  app.post('/snapshot', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.snapshot, c)
    return c.json(await readJsonOrThrow(() => getRepoSnapshot(cwd, c.req.raw.signal), 'snapshot'))
  })
  app.post('/status', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.status, c)
    return c.json(await readJsonOrThrow(() => getRepoStatus(cwd, c.req.raw.signal), 'status'))
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
  app.post('/pull-requests', async (c) => {
    const { cwd, branches, mode } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.pullRequests, c)
    return c.json(
      await readJsonOrThrow(
        () => getRepoPullRequests(cwd, branches, { mode: mode ?? 'full', signal: c.req.raw.signal }),
        'pull-requests',
      ),
    )
  })
  app.post('/composite', async (c) => {
    const { cwd, include, branches, mode, timeoutMs } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.composite, c)
    const wants = (include ?? ['snapshot', 'status', 'pullRequests']) as ReadonlyArray<
      'snapshot' | 'status' | 'pullRequests'
    >
    return c.json(
      await readJsonOrThrow(
        () =>
          readRepoBulk(cwd, wants, {
            branches,
            mode,
            signal: c.req.raw.signal,
            timeoutMs,
          }),
        'composite',
      ),
    )
  })
  app.post('/fetch', async (c) => {
    const { cwd, kind, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fetch, c)
    return c.json(
      await jsonOr(() => fetchRepo(cwd, kind ?? 'user', sourceToken, c.req.raw.signal), READ_REPO_ERROR, 'fetch'),
    )
  })
  app.post('/clone', async (c) => {
    const { operationId, url, parentPath, directoryName } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.clone, c)
    return c.json(
      await jsonOr(
        () => cloneRepo(operationId, url, parentPath, directoryName, c.req.raw.signal),
        READ_REPO_ERROR,
        'clone',
      ),
    )
  })
  app.post('/abort-clone', async (c) => {
    const { operationId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.abortClone, c)
    return c.json(await jsonOr(async () => abortCloneOperation(operationId), false, 'abort-clone'))
  })
  app.post('/pull', async (c) => {
    const { cwd, branch, worktreePath, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.pull, c)
    return c.json(
      await jsonOr(
        () => pullRepoBranch(cwd, branch, worktreePath, c.req.raw.signal, sourceToken),
        READ_REPO_ERROR,
        'pull',
      ),
    )
  })
  app.post('/push', async (c) => {
    const { cwd, branch, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.push, c)
    return c.json(
      await jsonOr(() => pushRepoBranch(cwd, branch, c.req.raw.signal, sourceToken), READ_REPO_ERROR, 'push'),
    )
  })
  app.post('/create-worktree', async (c) => {
    const { cwd, worktreePath, mode, sourceToken, worktreeBootstrap } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.createWorktree,
      c,
    )
    return c.json(
      await jsonOr(
        () =>
          createRepoWorktree(cwd, { worktreePath, mode }, c.req.raw.signal, sourceToken, {
            worktreeBootstrap,
          }),
        READ_REPO_ERROR,
        'create-worktree',
      ),
    )
  })
  app.post('/delete-branch', async (c) => {
    const { cwd, branch, force, alsoDeleteUpstream, sourceToken } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.deleteBranch,
      c,
    )
    return c.json(
      await jsonOr(
        () => deleteRepoBranch(cwd, branch, { force, alsoDeleteUpstream }, c.req.raw.signal, sourceToken),
        READ_REPO_ERROR,
        'delete-branch',
      ),
    )
  })
  app.post('/remove-worktree', async (c) => {
    const { cwd, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream, sourceToken } =
      await parseHttpBody(REPO_PROCEDURE_SCHEMAS.removeWorktree, c)
    return c.json(
      await jsonOr(
        () =>
          removeRepoWorktree(
            cwd,
            { branch, worktreePath, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream },
            c.req.raw.signal,
            sourceToken,
          ),
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
        repoInstanceId: getOrOpenRepoRuntimeInstance(userId, repo.id),
      })
    }
    return c.json({ ok: true as const, repoInstanceId: openRepoRuntimeInstance(userId, input.repoRoot) })
  })
  app.post('/runtime-list', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    await parseHttpBody(REPO_PROCEDURE_SCHEMAS.runtimeList, c)
    return c.json({ instances: listRepoRuntimeInstances(userId) })
  })
  app.post('/runtime-close', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { repoRoot, repoInstanceId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.runtimeClose, c)
    return c.json({ ok: true as const, closed: closeRepoRuntimeInstance(userId, repoRoot, repoInstanceId) })
  })
  app.post('/abort', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.abort, c)
    return c.json(await jsonOr(async () => abortRepoOperation(cwd), false, 'abort'))
  })
  return app
}
