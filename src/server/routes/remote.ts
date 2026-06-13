import {
  getServerRemotePathSuggestions,
  getServerSshHosts,
  openServerRemoteEditor,
  openServerRemoteTerminal,
  resolveServerRemoteTarget,
  testServerRemoteRepository,
} from '#/server/modules/remote.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { REMOTE_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'

export function createRemoteRoutes() {
  const app = createRouteApp()
  app.get('/ssh-hosts', async (c) => c.json(await getServerSshHosts()))
  app.post('/resolve-target', async (c) => {
    const { alias, remotePath } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.resolveTarget, c)
    return c.json(await resolveServerRemoteTarget({ alias, remotePath }, c.req.raw.signal))
  })
  app.post('/path-suggestions', async (c) => {
    const { alias, remotePath, prefix } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.pathSuggestions, c)
    return c.json(await getServerRemotePathSuggestions({ alias, remotePath, prefix }, c.req.raw.signal))
  })
  app.post('/test-repository', async (c) => {
    const { target } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.testRepository, c)
    return c.json(await testServerRemoteRepository(target, c.req.raw.signal))
  })
  app.post('/open-editor', async (c) => {
    const body = await c.req.json().catch(() => null)
    const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    return c.json(await openServerRemoteEditor({ repoId, worktreePath }, c.req.raw.signal))
  })
  app.post('/open-terminal', async (c) => {
    const body = await c.req.json().catch(() => null)
    const repoId = typeof body?.repoId === 'string' ? body.repoId : ''
    const worktreePath = typeof body?.worktreePath === 'string' ? body.worktreePath : ''
    return c.json(await openServerRemoteTerminal({ repoId, worktreePath }, c.req.raw.signal))
  })
  return app
}
