import { Hono } from 'hono'
import {
  abortCloneOperation,
  abortRepositoryOperation,
  checkoutRepositoryBranch,
  cloneRepository,
  createRepositoryWorktree,
  deleteRepositoryBranch,
  fetchRepository,
  getBackgroundSyncRepos,
  getRepositoryPatch,
  getRepositoryPullRequests,
  getRepositorySnapshot,
  getRepositoryStatus,
  openRepositoryEditor,
  openRepositoryRemote,
  openRepositoryTerminal,
  probeRepository,
  removeRepositoryWorktree,
  pullRepositoryBranch,
  pushRepositoryBranch,
  setBackgroundSyncRepos,
} from '#/server/modules/repo.ts'
import { getServerFetchIntervalSec } from '#/server/modules/settings-source.ts'

export function createRepoRoutes() {
  const app = new Hono()
  async function jsonOr<T>(run: () => Promise<T>, fallback: T, label: string) {
    try {
      return await run()
    } catch (err) {
      console.warn(`[server][repo] ${label} failed`, err)
      return fallback
    }
  }
  app.post('/probe', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    return c.json(await jsonOr(() => probeRepository(cwd), { ok: false, message: 'error.failed-read-repo' }, 'probe'))
  })
  app.post('/snapshot', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    return c.json(await jsonOr(() => getRepositorySnapshot(cwd, c.req.raw.signal), null, 'snapshot'))
  })
  app.post('/status', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    return c.json(await jsonOr(() => getRepositoryStatus(cwd, c.req.raw.signal), [], 'status'))
  })
  app.post('/patch', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    return c.json(await jsonOr(() => getRepositoryPatch(cwd, worktreePath, c.req.raw.signal), { ok: false, message: 'error.failed-read-repo' }, 'patch'))
  })
  app.post('/pull-requests', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const branches = Array.isArray(body?.branches)
      ? body.branches.filter((branch: unknown): branch is string => typeof branch === 'string')
      : undefined
    const mode = body?.options?.mode === 'summary' ? 'summary' : 'full'
    return c.json(await jsonOr(() => getRepositoryPullRequests(cwd, branches, { mode, signal: c.req.raw.signal }), null, 'pull-requests'))
  })
  app.post('/fetch', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const kind = body?.kind === 'background' ? 'background' : 'user'
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(await jsonOr(() => fetchRepository(cwd, kind, sourceToken), { ok: false, message: 'error.failed-read-repo' }, 'fetch'))
  })
  app.post('/clone', async (c) => {
    const body = await c.req.json().catch(() => null)
    const operationId = typeof body?.operationId === 'string' ? body.operationId : ''
    const url = typeof body?.url === 'string' ? body.url : ''
    const parentPath = typeof body?.parentPath === 'string' ? body.parentPath : ''
    const directoryName = typeof body?.directoryName === 'string' ? body.directoryName : ''
    return c.json(await jsonOr(() => cloneRepository(operationId, url, parentPath, directoryName), { ok: false, message: 'error.failed-read-repo' }, 'clone'))
  })
  app.post('/abort-clone', async (c) => {
    const body = await c.req.json().catch(() => null)
    const operationId = typeof body?.operationId === 'string' ? body.operationId : ''
    return c.json(await jsonOr(async () => abortCloneOperation(operationId), false, 'abort-clone'))
  })
  app.post('/checkout', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const branch = typeof body?.branch === 'string' ? body.branch : ''
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(await jsonOr(() => checkoutRepositoryBranch(cwd, branch, c.req.raw.signal, sourceToken), { ok: false, message: 'error.failed-read-repo' }, 'checkout'))
  })
  app.post('/pull', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const branch = typeof body?.branch === 'string' ? body.branch : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : undefined
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(await jsonOr(() => pullRepositoryBranch(cwd, branch, worktreePath, c.req.raw.signal, sourceToken), { ok: false, message: 'error.failed-read-repo' }, 'pull'))
  })
  app.post('/push', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const branch = typeof body?.branch === 'string' ? body.branch : ''
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(await jsonOr(() => pushRepositoryBranch(cwd, branch, c.req.raw.signal, sourceToken), { ok: false, message: 'error.failed-read-repo' }, 'push'))
  })
  app.post('/create-worktree', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    const newBranch = typeof body?.newBranch === 'string' ? body.newBranch : ''
    const baseBranch = typeof body?.baseBranch === 'string' ? body.baseBranch : ''
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(await jsonOr(() => createRepositoryWorktree(cwd, worktreePath, newBranch, baseBranch, c.req.raw.signal, sourceToken), { ok: false, message: 'error.failed-read-repo' }, 'create-worktree'))
  })
  app.post('/delete-branch', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const branch = typeof body?.branch === 'string' ? body.branch : ''
    const force = body?.force === true
    const alsoDeleteUpstream = body?.alsoDeleteUpstream === true
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(await jsonOr(() => deleteRepositoryBranch(cwd, branch, { force, alsoDeleteUpstream }, c.req.raw.signal, sourceToken), { ok: false, message: 'error.failed-read-repo' }, 'delete-branch'))
  })
  app.post('/remove-worktree', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const branch = typeof body?.branch === 'string' ? body.branch : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    const alsoDeleteBranch = body?.alsoDeleteBranch === true
    const forceDeleteBranch = body?.forceDeleteBranch === true
    const alsoDeleteUpstream = body?.alsoDeleteUpstream === true
    const sourceToken = typeof body?.sourceToken === 'string' ? body.sourceToken : undefined
    return c.json(await jsonOr(
      () => removeRepositoryWorktree(
        cwd,
        { branch, worktreePath, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream },
        c.req.raw.signal,
        sourceToken,
      ),
      { ok: false, message: 'error.failed-read-repo' },
      'remove-worktree',
    ))
  })
  app.post('/open-remote', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    const branch = typeof body?.branch === 'string' ? body.branch : undefined
    return c.json(await jsonOr(() => openRepositoryRemote(cwd, branch, c.req.raw.signal), { ok: false, message: 'error.failed-read-repo' }, 'open-remote'))
  })
  app.post('/open-terminal', async (c) => {
    const body = await c.req.json().catch(() => null)
    const path = typeof body?.path === 'string' ? body.path : ''
    return c.json(await jsonOr(() => openRepositoryTerminal(path), { ok: false, message: 'error.failed-read-repo' }, 'open-terminal'))
  })
  app.post('/open-editor', async (c) => {
    const body = await c.req.json().catch(() => null)
    const path = typeof body?.path === 'string' ? body.path : ''
    return c.json(await jsonOr(() => openRepositoryEditor(path), { ok: false, message: 'error.failed-read-repo' }, 'open-editor'))
  })
  app.post('/background-sync-repos', async (c) => {
    const body = await c.req.json().catch(() => null)
    const repoIds = Array.isArray(body?.repoIds)
      ? body.repoIds.filter((repoId: unknown): repoId is string => typeof repoId === 'string' && repoId.length > 0)
      : []
    return c.json(await jsonOr(async () => {
      await setBackgroundSyncRepos(repoIds)
      return { ok: true, repoIds: getBackgroundSyncRepos(), intervalSec: await getServerFetchIntervalSec() }
    }, { ok: true as const, repoIds: [], intervalSec: 0 }, 'background-sync-repos'))
  })
  app.post('/abort', async (c) => {
    const body = await c.req.json().catch(() => null)
    const cwd = typeof body?.cwd === 'string' ? body.cwd : ''
    return c.json(await jsonOr(async () => abortRepositoryOperation(cwd), false, 'abort'))
  })
  return app
}
