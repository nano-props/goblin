import {
  getServerRemotePathSuggestions,
  getServerSshHosts,
  resolveServerRemoteTarget,
  testServerRemoteWorkspace,
} from '#/server/modules/remote-workspace.ts'
import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { REMOTE_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import { runRemoteWorkspaceLifecycleWrite } from '#/server/modules/remote-workspace-lifecycle-write-paths.ts'
import {
  commitGitCapabilityRemovalOrThrow,
  type WorkspaceCapabilityTransitionHost,
} from '#/server/workspace-capability-transition-host.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'
import {
  requireWorkspaceRuntimeEpochCapability,
  runWorkspaceRuntimeRequest,
} from '#/server/modules/workspace-runtime-request.ts'

export function createRemoteRoutes(options: { workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost }) {
  const app = createRouteApp()
  app.get('/ssh-hosts', async (c) => c.json(await getServerSshHosts()))
  app.post('/resolve-target', async (c) => {
    const { alias, remotePath } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.resolveTarget, c)
    return c.json(await resolveServerRemoteTarget({ alias, remotePath }, c.req.raw.signal))
  })
  app.post('/lifecycle', async (c) => {
    const { workspaceId, workspaceRuntimeId, mode } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.remoteLifecycle, c)
    const runtimeCapability = requireWorkspaceRuntimeEpochCapability(
      userIdFromContext(c),
      workspaceId,
      workspaceRuntimeId,
    )
    const { userId } = runtimeCapability
    return c.json(
      await runWorkspaceRuntimeRequest({
        userId,
        label: 'remote-workspace-lifecycle',
        signal: c.req.raw.signal,
        run: async () =>
          await runRemoteWorkspaceLifecycleWrite(
            { userId, workspaceId, workspaceRuntimeId, mode: mode ?? 'restart' },
            {
              beforeCapabilityCommit: async ({ before, after }) => {
                if (!workspaceGitCleanupRequired(before, after)) return
                await commitGitCapabilityRemovalOrThrow(options.workspaceCapabilityTransitionHost, {
                  runtimeCapability,
                })
              },
            },
          ),
      }),
    )
  })
  app.post('/path-suggestions', async (c) => {
    const { alias, prefix } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.pathSuggestions, c)
    return c.json(await getServerRemotePathSuggestions({ alias, prefix }, c.req.raw.signal))
  })
  app.post('/test-workspace', async (c) => {
    const { target } = await parseHttpBody(REMOTE_PROCEDURE_SCHEMAS.testWorkspace, c)
    return c.json(await testServerRemoteWorkspace(target, c.req.raw.signal))
  })
  return app
}
