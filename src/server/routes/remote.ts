import {
  getServerRemotePathSuggestions,
  getServerSshHosts,
  openServerRemoteEditor,
  openServerRemoteTerminal,
  resolveServerRemoteRepoConnection,
  resolveServerRemoteTarget,
  testServerRemoteRepo,
} from '#/server/modules/remote.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { REMOTE_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import { runRepoRemoteLifecycle } from '#/server/modules/repo-runtimes.ts'
import { publishUserRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import type { RemoteRepoLifecycleCommandResult } from '#/shared/remote-repo.ts'

export function createRemoteRoutes() {
  const app = createRouteApp()
  app.get('/ssh-hosts', async (c) => c.json(await getServerSshHosts()))
  app.post('/resolve-target', async (c) => {
    const { alias, remotePath } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.resolveTarget, c)
    return c.json(await resolveServerRemoteTarget({ alias, remotePath }, c.req.raw.signal))
  })
  // Server-owned lifecycle command. RepoRuntime publishes connecting
  // immediately and returns the accepted terminal projection.
  app.post('/lifecycle', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { repoId, repoRuntimeId, mode } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.remoteLifecycle, c)
    const result = await runRepoRemoteLifecycle(
      userId,
      repoId,
      repoRuntimeId,
      (attemptSignal) => resolveServerRemoteRepoConnection({ repoId }, attemptSignal),
      () => publishUserRepoQueryInvalidation(userId, { repoId, query: 'remote-lifecycle' }),
      mode,
    )
    if (result.kind !== 'settled') {
      return c.json({ kind: result.kind, repoId } satisfies RemoteRepoLifecycleCommandResult)
    }
    return c.json({
      kind: 'settled',
      repoId,
      name: result.name,
      lifecycle: result.lifecycle,
    } satisfies RemoteRepoLifecycleCommandResult)
  })
  app.post('/path-suggestions', async (c) => {
    const { alias, remotePath, prefix } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.pathSuggestions, c)
    return c.json(await getServerRemotePathSuggestions({ alias, remotePath, prefix }, c.req.raw.signal))
  })
  app.post('/test-repo', async (c) => {
    const { target } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.testRepo, c)
    return c.json(await testServerRemoteRepo(target, c.req.raw.signal))
  })
  app.post('/open-editor', async (c) => {
    const { repoId, worktreePath, app } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.openEditor, c)
    return c.json(await openServerRemoteEditor({ repoId, worktreePath, app }, c.req.raw.signal))
  })
  app.post('/open-terminal', async (c) => {
    const { repoId, worktreePath, app } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.openTerminal, c)
    return c.json(await openServerRemoteTerminal({ repoId, worktreePath, app }, c.req.raw.signal))
  })
  return app
}
