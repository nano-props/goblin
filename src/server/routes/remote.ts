import {
  getServerRemotePathSuggestions,
  getServerSshHosts,
  resolveServerRemoteTarget,
  testServerRemoteRepo,
} from '#/server/modules/remote.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { REMOTE_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import { runRemoteLifecycleWrite } from '#/server/modules/remote-lifecycle-write-paths.ts'
import { isCurrentWorkspaceRuntime } from '#/server/modules/workspace-runtimes.ts'
import {
  commitGitCapabilityRemovalOrThrow,
  type WorkspaceCapabilityTransitionHost,
} from '#/server/workspace-capability-transition-host.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'

export function createRemoteRoutes(options: { workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost }) {
  const app = createRouteApp()
  app.get('/ssh-hosts', async (c) => c.json(await getServerSshHosts()))
  app.post('/resolve-target', async (c) => {
    const { alias, remotePath } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.resolveTarget, c)
    return c.json(await resolveServerRemoteTarget({ alias, remotePath }, c.req.raw.signal))
  })
  app.post('/lifecycle', async (c) => {
    const userId = userIdFromContext(c)
    if (!userId) return c.json({ ok: false as const, message: 'Unauthorized' }, 401)
    const { repoId, workspaceRuntimeId, mode } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.remoteLifecycle, c)
    return c.json(
      await runRemoteLifecycleWrite(
        { userId, repoId, workspaceRuntimeId, mode: mode ?? 'restart' },
        {
          beforeCapabilityCommit: async ({ before, after }) => {
            if (!workspaceGitCleanupRequired(before, after)) return
            await commitGitCapabilityRemovalOrThrow(options.workspaceCapabilityTransitionHost, {
              userId,
              workspaceId: repoId,
              workspaceRuntimeId: workspaceRuntimeId,
              assertCurrent: () => {
                if (!isCurrentWorkspaceRuntime(userId, repoId, workspaceRuntimeId)) {
                  throw new Error('error.workspace-runtime-stale')
                }
              },
            })
          },
        },
      ),
    )
  })
  app.post('/path-suggestions', async (c) => {
    const { alias, remotePath, prefix } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.pathSuggestions, c)
    return c.json(await getServerRemotePathSuggestions({ alias, remotePath, prefix }, c.req.raw.signal))
  })
  app.post('/test-repo', async (c) => {
    const { target } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.testRepo, c)
    return c.json(await testServerRemoteRepo(target, c.req.raw.signal))
  })
  return app
}
