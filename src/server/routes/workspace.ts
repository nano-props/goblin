import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import {
  acquireWorkspaceRuntime,
  isCurrentWorkspaceRuntime,
  listWorkspaceRuntimes,
  releaseWorkspaceRuntime,
  replaceWorkspaceRuntimeMembershipsForClient,
  runSerializedInitialWorkspaceProbe,
  runSerializedWorkspaceRefresh,
} from '#/server/modules/workspace-runtimes.ts'
import { probeLocalWorkspace, probeWorkspace } from '#/server/modules/workspace-probe.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'
import {
  commitGitCapabilityRemovalOrThrow,
  type WorkspaceCapabilityTransitionHost,
} from '#/server/workspace-capability-transition-host.ts'
import { IpcError } from '#/shared/api-types.ts'
import { WORKSPACE_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import {
  formatWorkspaceLocator,
  parseWorkspaceLocator,
  type WorkspaceId,
  type WorkspaceLocatorPlatform,
} from '#/shared/workspace-locator.ts'
import path from 'node:path'

export function createWorkspaceRoutes(options: {
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
}) {
  const app = createRouteApp()

  app.post('/refresh', async (c) => {
    const { workspaceId, workspaceRuntimeId } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.refresh, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), workspaceId, workspaceRuntimeId)
    const platform = serverLocatorPlatform()
    return c.json(
      await runSerializedWorkspaceRefresh({
        userId,
        workspaceId,
        workspaceRuntimeId,
        probe: async () => await probeWorkspace(workspaceId, platform, { signal: c.req.raw.signal }),
        beforeCommit: async ({ before, after }) => {
          if (!workspaceGitCleanupRequired(before, after)) return
          await commitGitCapabilityRemovalOrThrow(options.workspaceCapabilityTransitionHost, {
            userId,
            workspaceId,
            workspaceRuntimeId,
            assertCurrent: () => requireCurrentWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId),
          })
        },
      }),
    )
  })

  app.post('/runtime-open', async (c) => {
    const userId = requireUserId(userIdFromContext(c))
    const input = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.runtimeOpen, c)
    if ('workspaceInput' in input) {
      const platform = serverLocatorPlatform()
      const workspaceId = workspaceLocatorFromCommandInput(input.workspaceInput, platform)
      if (!workspaceId) {
        return c.json({ ok: false as const, input: input.workspaceInput, reason: 'error.workspace-locator-malformed' })
      }
      const probe = await probeLocalWorkspace(workspaceId, platform, { signal: c.req.raw.signal })
      if (probe.status !== 'ready') {
        return c.json({ ok: false as const, input: input.workspaceInput, reason: probe.reason })
      }
      const workspaceRuntimeId = acquireWorkspaceRuntime(userId, workspaceId, input.clientId)
      const authoritativeProbe = await runSerializedInitialWorkspaceProbe({
        userId,
        workspaceId,
        workspaceRuntimeId,
        probe: async () => probe,
        beforeCommit: async ({ before, after }) => {
          if (!workspaceGitCleanupRequired(before, after)) return
          await commitGitCapabilityRemovalOrThrow(options.workspaceCapabilityTransitionHost, {
            userId,
            workspaceId,
            workspaceRuntimeId,
            assertCurrent: () => requireCurrentWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId),
          })
        },
      })
      if (!authoritativeProbe || authoritativeProbe.status !== 'ready') {
        return c.json({
          ok: false as const,
          input: input.workspaceInput,
          reason: 'error.workspace-transport-unavailable',
        })
      }
      return c.json({
        ok: true as const,
        workspace: { id: workspaceId, name: authoritativeProbe.name },
        workspaceRuntimeId,
        capabilities: authoritativeProbe.capabilities,
        diagnostics: authoritativeProbe.diagnostics,
      })
    }
    const workspaceRuntimeId = acquireWorkspaceRuntime(userId, input.workspaceId, input.clientId)
    return c.json({ ok: true as const, workspaceRuntimeId })
  })

  app.post('/runtime-list', async (c) => {
    const userId = requireUserId(userIdFromContext(c))
    await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.runtimeList, c)
    return c.json({ runtimes: listWorkspaceRuntimes(userId) })
  })

  app.post('/runtime-reconcile', async (c) => {
    const userId = requireUserId(userIdFromContext(c))
    const { clientId, workspaceIds } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.runtimeReconcile, c)
    return c.json({ runtimes: replaceWorkspaceRuntimeMembershipsForClient(userId, clientId, workspaceIds) })
  })

  app.post('/runtime-close', async (c) => {
    const userId = requireUserId(userIdFromContext(c))
    const { workspaceId, workspaceRuntimeId, clientId } = await parseHttpBody(
      WORKSPACE_PROCEDURE_SCHEMAS.runtimeClose,
      c,
    )
    return c.json({
      ok: true as const,
      ...releaseWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId, clientId),
    })
  })

  return app
}

function requireUserId(userId: string | null | undefined): string {
  if (!userId) throw new IpcError({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
  return userId
}

function requireCurrentWorkspaceRuntime(
  userId: string | null | undefined,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): string {
  const requiredUserId = requireUserId(userId)
  if (!isCurrentWorkspaceRuntime(requiredUserId, workspaceId, workspaceRuntimeId)) {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })
  }
  return requiredUserId
}

function serverLocatorPlatform(): WorkspaceLocatorPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

function workspaceLocatorFromCommandInput(input: string, platform: WorkspaceLocatorPlatform): WorkspaceId | null {
  const parsed = parseWorkspaceLocator(input, platform)
  if (parsed?.transport === 'file') return formatWorkspaceLocator(parsed, platform)
  const implementation = platform === 'win32' ? path.win32 : path.posix
  if (!implementation.isAbsolute(input)) return null
  return formatWorkspaceLocator({ transport: 'file', platform, path: input }, platform)
}
