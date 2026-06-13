import { getBackgroundSyncRepos, setBackgroundSyncRepos } from '#/server/modules/background-sync.ts'
import {
  getRepositoryComposite,
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
import { createRouteApp, parseHttpBody, parseHttpQuery } from '#/server/common/http-validate.ts'
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
  app.get('/composite', async (c) => {
    const { cwd, include, branches, mode, timeoutMs } = parseHttpQuery(REPO_QUERY_SCHEMAS.composite, c)
    const wants = (include ?? ['snapshot', 'status', 'pullRequests']) as ReadonlyArray<
      'snapshot' | 'status' | 'pullRequests'
    >
    return c.json(
      await getRepositoryComposite(cwd, wants, {
        branches,
        mode,
        signal: c.req.raw.signal,
        timeoutMs,
      }).catch((err) => {
        console.warn('[server][repo] composite failed', err)
        return { snapshot: null, status: [], pullRequests: null }
      }),
    )
  })
  app.post('/fetch', async (c) => {
    const { cwd, kind, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.fetch, c)
    return c.json(
      await jsonOr(
        () => fetchRepository(cwd, kind ?? 'user', sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'fetch',
      ),
    )
  })
  app.post('/clone', async (c) => {
    const { operationId, url, parentPath, directoryName } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.clone, c)
    return c.json(
      await jsonOr(
        () => cloneRepository(operationId, url, parentPath, directoryName),
        { ok: false, message: 'error.failed-read-repo' },
        'clone',
      ),
    )
  })
  app.post('/abort-clone', async (c) => {
    const { operationId } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.abortClone, c)
    return c.json(await jsonOr(async () => abortCloneOperation(operationId), false, 'abort-clone'))
  })
  app.post('/checkout', async (c) => {
    const { cwd, branch, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.checkout, c)
    return c.json(
      await jsonOr(
        () => checkoutRepositoryBranch(cwd, branch, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'checkout',
      ),
    )
  })
  app.post('/pull', async (c) => {
    const { cwd, branch, worktreePath, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.pull, c)
    return c.json(
      await jsonOr(
        () => pullRepositoryBranch(cwd, branch, worktreePath, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'pull',
      ),
    )
  })
  app.post('/push', async (c) => {
    const { cwd, branch, sourceToken } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.push, c)
    return c.json(
      await jsonOr(
        () => pushRepositoryBranch(cwd, branch, c.req.raw.signal, sourceToken),
        { ok: false, message: 'error.failed-read-repo' },
        'push',
      ),
    )
  })
  app.post('/create-worktree', async (c) => {
    const { cwd, worktreePath, newBranch, baseBranch, sourceToken } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.createWorktree,
      c,
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
    const { cwd, branch, force, alsoDeleteUpstream, sourceToken } = await parseHttpBody(
      REPO_PROCEDURE_SCHEMAS.deleteBranch,
      c,
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
        { ok: false, message: 'error.failed-read-repo' },
        'remove-worktree',
      ),
    )
  })
  app.post('/open-remote', async (c) => {
    const { cwd, branch } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openRemote, c)
    return c.json(
      await jsonOr(
        () => openRepositoryRemote(cwd, branch, c.req.raw.signal),
        { ok: false, message: 'error.failed-read-repo' },
        'open-remote',
      ),
    )
  })
  app.post('/open-terminal', async (c) => {
    const { path } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openTerminal, c)
    return c.json(
      await jsonOr(
        () => openRepositoryTerminal(path),
        { ok: false, message: 'error.failed-read-repo' },
        'open-terminal',
      ),
    )
  })
  app.post('/open-editor', async (c) => {
    const { path } = await parseHttpBody(REPO_PROCEDURE_SCHEMAS.openEditor, c)
    return c.json(
      await jsonOr(() => openRepositoryEditor(path), { ok: false, message: 'error.failed-read-repo' }, 'open-editor'),
    )
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
