import { getBackgroundSyncRepos, setBackgroundSyncRepos } from '#/server/modules/background-sync.ts'
import {
  getRepositoryPatch,
  getRepositoryPullRequests,
  getRepositorySnapshot,
  getRepositoryStatus,
  probeRepository,
} from '#/server/modules/repo-read-paths.ts'
import {
  abortCloneOperation,
  abortRepositoryOperation,
  checkoutRepositoryBranch,
  cloneRepository,
  createRepositoryWorktree,
  deleteRepositoryBranch,
  fetchRepository,
  openRepositoryEditor,
  openRepositoryRemote,
  openRepositoryTerminal,
  pullRepositoryBranch,
  pushRepositoryBranch,
  removeRepositoryWorktree,
} from '#/server/modules/repo-write-paths.ts'
import { getServerFetchIntervalSec } from '#/server/modules/settings-source.ts'
import { createRouteApp, parseHttpInput, parseHttpQuery } from '#/server/common/http-validate.ts'
import { REPO_PROCEDURE_SCHEMAS, REPO_QUERY_SCHEMAS } from '#/shared/procedure-schemas.ts'

export function createRepoRoutes() {
  const app = createRouteApp()
  async function jsonOr<T>(run: () => Promise<T>, fallback: T, label: string) {
    try {
      return await run()
    } catch (err) {
      console.warn(`[server][repo] ${label} failed`, err)
      return fallback
    }
  }

  app.get('/probe', async (c) => {
    const { cwd } = parseHttpQuery(REPO_QUERY_SCHEMAS.probe, c)
    return c.json(await jsonOr(() => probeRepository(cwd), { ok: false, message: 'error.failed-read-repo' }, 'probe'))
  })
  app.get('/snapshot', async (c) => {
    const { cwd } = parseHttpQuery(REPO_QUERY_SCHEMAS.snapshot, c)
    return c.json(await jsonOr(() => getRepositorySnapshot(cwd, c.req.raw.signal), null, 'snapshot'))
  })
  app.get('/status', async (c) => {
    const { cwd } = parseHttpQuery(REPO_QUERY_SCHEMAS.status, c)
    return c.json(await jsonOr(() => getRepositoryStatus(cwd, c.req.raw.signal), [], 'status'))
  })
  app.get('/patch', async (c) => {
    const { cwd, worktreePath } = parseHttpQuery(REPO_QUERY_SCHEMAS.patch, c)
    return c.json(
      await jsonOr(
        () => getRepositoryPatch(cwd, worktreePath, c.req.raw.signal),
        { ok: false, message: 'error.failed-read-repo' },
        'patch',
      ),
    )
  })
  app.get('/pull-requests', async (c) => {
    const { cwd, branches, mode } = parseHttpQuery(REPO_QUERY_SCHEMAS.pullRequests, c)
    return c.json(
      await jsonOr(
        () => getRepositoryPullRequests(cwd, branches, { mode: mode ?? 'full', signal: c.req.raw.signal }),
        null,
        'pull-requests',
      ),
    )
  })
  app.post('/fetch', async (c) => {
    const { cwd, kind, sourceToken } = parseHttpInput(
      REPO_PROCEDURE_SCHEMAS.fetch,
      await c.req.json().catch(() => null),
    )
    return c.json(
      await jsonOr(
        () => fetchRepository(cwd, kind ?? 'user', sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'fetch',
      ),
    )
  })
  app.post('/clone', async (c) => {
    const { operationId, url, parentPath, directoryName } = parseHttpInput(
      REPO_PROCEDURE_SCHEMAS.clone,
      await c.req.json().catch(() => null),
    )
    return c.json(
      await jsonOr(
        () => cloneRepository(operationId, url, parentPath, directoryName),
        { ok: false, message: 'error.failed-read-repo' },
        'clone',
      ),
    )
  })
  app.post('/abort-clone', async (c) => {
    const { operationId } = parseHttpInput(REPO_PROCEDURE_SCHEMAS.abortClone, await c.req.json().catch(() => null))
    return c.json(await jsonOr(async () => abortCloneOperation(operationId), false, 'abort-clone'))
  })
  app.post('/checkout', async (c) => {
    const { cwd, branch, sourceToken } = parseHttpInput(
      REPO_PROCEDURE_SCHEMAS.checkout,
      await c.req.json().catch(() => null),
    )
    return c.json(
      await jsonOr(
        () => checkoutRepositoryBranch(cwd, branch, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'checkout',
      ),
    )
  })
  app.post('/pull', async (c) => {
    const { cwd, branch, worktreePath, sourceToken } = parseHttpInput(
      REPO_PROCEDURE_SCHEMAS.pull,
      await c.req.json().catch(() => null),
    )
    return c.json(
      await jsonOr(
        () => pullRepositoryBranch(cwd, branch, worktreePath, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'pull',
      ),
    )
  })
  app.post('/push', async (c) => {
    const { cwd, branch, sourceToken } = parseHttpInput(
      REPO_PROCEDURE_SCHEMAS.push,
      await c.req.json().catch(() => null),
    )
    return c.json(
      await jsonOr(
        () => pushRepositoryBranch(cwd, branch, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'push',
      ),
    )
  })
  app.post('/create-worktree', async (c) => {
    const { cwd, worktreePath, newBranch, baseBranch, sourceToken } = parseHttpInput(
      REPO_PROCEDURE_SCHEMAS.createWorktree,
      await c.req.json().catch(() => null),
    )
    return c.json(
      await jsonOr(
        () => createRepositoryWorktree(cwd, worktreePath, newBranch, baseBranch, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'create-worktree',
      ),
    )
  })
  app.post('/delete-branch', async (c) => {
    const { cwd, branch, force, alsoDeleteUpstream, sourceToken } = parseHttpInput(
      REPO_PROCEDURE_SCHEMAS.deleteBranch,
      await c.req.json().catch(() => null),
    )
    return c.json(
      await jsonOr(
        () => deleteRepositoryBranch(cwd, branch, { force, alsoDeleteUpstream }, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'delete-branch',
      ),
    )
  })
  app.post('/remove-worktree', async (c) => {
    const { cwd, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream, sourceToken } =
      parseHttpInput(REPO_PROCEDURE_SCHEMAS.removeWorktree, await c.req.json().catch(() => null))
    return c.json(
      await jsonOr(
        () =>
          removeRepositoryWorktree(
            cwd,
            { branch, worktreePath, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream },
            c.req.raw.signal,
            sourceToken,
          ),
        { ok: false, message: 'error.failed-read-repo' },
        'remove-worktree',
      ),
    )
  })
  app.post('/open-remote', async (c) => {
    const { cwd, branch } = parseHttpInput(REPO_PROCEDURE_SCHEMAS.openRemote, await c.req.json().catch(() => null))
    return c.json(
      await jsonOr(
        () => openRepositoryRemote(cwd, branch, c.req.raw.signal),
        { ok: false, message: 'error.failed-read-repo' },
        'open-remote',
      ),
    )
  })
  app.post('/open-terminal', async (c) => {
    const { path } = parseHttpInput(REPO_PROCEDURE_SCHEMAS.openTerminal, await c.req.json().catch(() => null))
    return c.json(
      await jsonOr(
        () => openRepositoryTerminal(path),
        { ok: false, message: 'error.failed-read-repo' },
        'open-terminal',
      ),
    )
  })
  app.post('/open-editor', async (c) => {
    const { path } = parseHttpInput(REPO_PROCEDURE_SCHEMAS.openEditor, await c.req.json().catch(() => null))
    return c.json(
      await jsonOr(() => openRepositoryEditor(path), { ok: false, message: 'error.failed-read-repo' }, 'open-editor'),
    )
  })
  app.post('/background-sync-repos', async (c) => {
    const { repoIds } = parseHttpInput(REPO_PROCEDURE_SCHEMAS.backgroundSyncRepos, await c.req.json().catch(() => null))
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
    const { cwd } = parseHttpInput(REPO_PROCEDURE_SCHEMAS.abort, await c.req.json().catch(() => null))
    return c.json(await jsonOr(async () => abortRepositoryOperation(cwd), false, 'abort'))
  })
  return app
}
