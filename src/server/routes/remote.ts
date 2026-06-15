import {
  getServerRemotePathSuggestions,
  getServerSshHosts,
  openServerRemoteEditor,
  openServerRemoteTerminal,
  resolveServerRemoteRepoLifecycle,
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
  // Unified lifecycle boundary (docs/.../plan §5). The renderer
  // calls this from the orchestrator's task; the server returns
  // a converged `ready`/`failed` lifecycle result. NEVER
  // returns `connecting` — that's a renderer projection.
  app.post('/lifecycle', async (c) => {
    const { repoId } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.remoteLifecycle, c)
    return c.json(await resolveServerRemoteRepoLifecycle({ repoId }, c.req.raw.signal))
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
    const { repoId, worktreePath } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.openEditor, c)
    return c.json(await openServerRemoteEditor({ repoId, worktreePath }, c.req.raw.signal))
  })
  app.post('/open-terminal', async (c) => {
    const { repoId, worktreePath } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.openTerminal, c)
    return c.json(await openServerRemoteTerminal({ repoId, worktreePath }, c.req.raw.signal))
  })
  return app
}
