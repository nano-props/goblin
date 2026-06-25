import { getBackgroundSyncRepos, setBackgroundSyncRepos } from '#/server/modules/background-sync.ts'
import { serverRepoNodeLog } from '#/node/logger.ts'
import {
  getRepositoryComposite,
  getRepositoryLog,
  getRepositoryPatch,
  getRepositoryPullRequests,
  getRepositorySnapshot,
  getRepositoryStatus,
  probeRepository,
} from '#/server/modules/repo-read-paths.ts'
import {
  abortCloneOperation,
  abortRepositoryOperation,
  cloneRepository,
  createRepositoryWorktree,
  deleteRepositoryBranch,
  fetchRepository,
  getRepositoryRemoteBranches,
  openRepositoryEditor,
  openRepositoryRemote,
  openRepositoryTerminal,
  pullRepositoryBranch,
  pushRepositoryBranch,
  removeRepositoryWorktree,
} from '#/server/modules/repo-write-paths.ts'
import { getServerFetchIntervalSec } from '#/server/modules/settings-source.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { REPO_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import type { RepositoryLogResponse } from '#/shared/api-types.ts'
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

  app.post('/probe', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.probe, c)
    return c.json(await jsonOr(() => probeRepository(cwd), READ_REPO_ERROR, 'probe'))
  })
  app.post('/snapshot', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.snapshot, c)
    return c.json(await jsonOr(() => getRepositorySnapshot(cwd, c.req.raw.signal), null, 'snapshot'))
  })
  app.post('/status', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.status, c)
    return c.json(await jsonOr(() => getRepositoryStatus(cwd, c.req.raw.signal), [], 'status'))
  })
  app.post('/log', async (c) => {
    const { cwd, branch, count, skip } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.log, c)
    return c.json(
      await jsonOr<RepositoryLogResponse>(
        () =>
          getRepositoryLog(cwd, branch, {
            count: count ?? DEFAULT_REPOSITORY_LOG_COUNT,
            skip: skip ?? 0,
            signal: c.req.raw.signal,
          }),
        READ_REPO_ERROR,
        'log',
      ),
    )
  })
  app.post('/remote-branches', async (c) => {
    const { cwd } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.getRemoteBranches, c)
    return c.json(await jsonOr(() => getRepositoryRemoteBranches(cwd, c.req.raw.signal), [], 'remote-branches'))
  })
  app.post('/patch', async (c) => {
    const { cwd, worktreePath } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.patch, c)
    return c.json(await jsonOr(() => getRepositoryPatch(cwd, worktreePath, c.req.raw.signal), READ_REPO_ERROR, 'patch'))
  })
  app.post('/pull-requests', async (c) => {
    const { cwd, branches, mode } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.pullRequests, c)
    return c.json(
      await jsonOr(
        () => getRepositoryPullRequests(cwd, branches, { mode: mode ?? 'full', signal: c.req.raw.signal }),
        null,
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
      await jsonOr(
        () =>
          getRepositoryComposite(cwd, wants, {
            branches,
            mode,
            signal: c.req.raw.signal,
            timeoutMs,
          }),
        { snapshot: null, status: [], pullRequests: null },
        'composite',
      ),
    )
  })
  app.post('/fetch', async (c) => {
    const { cwd, kind, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fetch, c)
    return c.json(await jsonOr(() => fetchRepository(cwd, kind ?? 'user', sourceToken), READ_REPO_ERROR, 'fetch'))
  })
  app.post('/clone', async (c) => {
    const { operationId, url, parentPath, directoryName } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.clone, c)
    return c.json(
      await jsonOr(() => cloneRepository(operationId, url, parentPath, directoryName), READ_REPO_ERROR, 'clone'),
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
        () => pullRepositoryBranch(cwd, branch, worktreePath, c.req.raw.signal, sourceToken),
        READ_REPO_ERROR,
        'pull',
      ),
    )
  })
  app.post('/push', async (c) => {
    const { cwd, branch, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.push, c)
    return c.json(
      await jsonOr(() => pushRepositoryBranch(cwd, branch, c.req.raw.signal, sourceToken), READ_REPO_ERROR, 'push'),
    )
  })
  app.post('/create-worktree', async (c) => {
    const { cwd, worktreePath, mode, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.createWorktree, c)
    return c.json(
      await jsonOr(
        () => createRepositoryWorktree(cwd, { worktreePath, mode }, c.req.raw.signal, sourceToken),
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
        () => deleteRepositoryBranch(cwd, branch, { force, alsoDeleteUpstream }, c.req.raw.signal, sourceToken),
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
          removeRepositoryWorktree(
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
  app.post('/open-remote', async (c) => {
    const { cwd, branch } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openRemote, c)
    return c.json(
      await jsonOr(() => openRepositoryRemote(cwd, branch, c.req.raw.signal), READ_REPO_ERROR, 'open-remote'),
    )
  })
  app.post('/open-terminal', async (c) => {
    const { path } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openTerminal, c)
    return c.json(await jsonOr(() => openRepositoryTerminal(path), READ_REPO_ERROR, 'open-terminal'))
  })
  app.post('/open-editor', async (c) => {
    const { path } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openEditor, c)
    return c.json(await jsonOr(() => openRepositoryEditor(path), READ_REPO_ERROR, 'open-editor'))
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
    return c.json(await jsonOr(async () => abortRepositoryOperation(cwd), false, 'abort'))
  })
  return app
}
