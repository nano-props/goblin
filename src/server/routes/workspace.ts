import { createRouteApp, parseHttpBody } from '#/server/common/http-validate.ts'
import { userIdFromContext } from '#/server/common/identity.ts'
import {
  acquireWorkspaceRuntime,
  listWorkspaceRuntimes,
  releaseWorkspaceRuntime,
  replaceWorkspaceRuntimeMembershipsForClient,
  runSerializedInitialWorkspaceProbe,
  runSerializedWorkspaceRefresh,
  withWorkspaceRuntimeAdmission,
} from '#/server/modules/workspace-runtimes.ts'
import { readWorkspaceFilesystemTree } from '#/server/modules/workspace-filesystem-tree.ts'
import { readWorkspaceFileViewer } from '#/server/modules/workspace-file-viewer.ts'
import { readWorkspaceDirectoryOverview } from '#/server/modules/workspace-directory-overview.ts'
import { trashWorkspaceFile } from '#/server/modules/workspace-file-trash.ts'
import {
  openWorkspaceEditor,
  openWorkspaceInFinder,
  openWorkspaceTerminal,
} from '#/server/modules/workspace-external-apps.ts'
import {
  requireCurrentWorkspaceRuntime,
  runWorkspaceRuntimeRequest,
} from '#/server/modules/workspace-runtime-request.ts'
import {
  publishUserRepoQueryInvalidation,
  publishUserWorkspaceFilesystemInvalidation,
} from '#/server/modules/invalidation-broker.ts'
import { probeLocalWorkspace, probeWorkspace } from '#/server/modules/workspace-probe.ts'
import { workspaceGitCleanupRequired } from '#/server/modules/workspace-capability-transition.ts'
import {
  commitGitCapabilityRemovalOrThrow,
  type WorkspaceCapabilityTransitionHost,
} from '#/server/workspace-capability-transition-host.ts'
import { IpcError } from '#/shared/api-types.ts'
import { WORKSPACE_PROCEDURE_SCHEMAS } from '#/shared/procedure-schemas.ts'
import type { WorkspaceId, WorkspaceLocatorPlatform } from '#/shared/workspace-locator.ts'
import { homedir } from 'node:os'
import { canonicalRuntimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-validators.ts'
import type { RuntimeWorkspacePaneTarget, WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { getLocalPathSuggestions } from '#/server/modules/local-path-suggestions.ts'
import { workspaceLocatorFromNativeCommandInput } from '#/server/modules/native-workspace-input.ts'

export function createWorkspaceRoutes(options: {
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
}) {
  const app = createRouteApp()

  app.post('/path-suggestions', async (c) => {
    const { prefix } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.pathSuggestions, c)
    return c.json(await getLocalPathSuggestions(prefix, c.req.raw.signal))
  })

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
      const workspaceId = workspaceLocatorFromNativeCommandInput(input.workspaceInput, platform, homedir())
      if (!workspaceId) {
        return c.json({ ok: false as const, input: input.workspaceInput, reason: 'error.workspace-locator-malformed' })
      }
      const probe = await probeLocalWorkspace(workspaceId, platform, { signal: c.req.raw.signal })
      if (probe.status !== 'ready') {
        return c.json({ ok: false as const, input: input.workspaceInput, reason: probe.reason })
      }
      return c.json(
        await withWorkspaceRuntimeAdmission(userId, workspaceId, input.clientId, async (workspaceRuntimeId) => {
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
            throw new IpcError({ code: 'INTERNAL_SERVER_ERROR', message: 'error.workspace-transport-unavailable' })
          }
          return {
            ok: true as const,
            workspace: { id: workspaceId, name: authoritativeProbe.name },
            workspaceRuntimeId,
            capabilities: authoritativeProbe.capabilities,
            diagnostics: authoritativeProbe.diagnostics,
          }
        }),
      )
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

  app.post('/directory-overview', async (c) => {
    const { workspaceId, workspaceRuntimeId } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.directoryOverview, c)
    const userId = requireCurrentWorkspaceRuntime(userIdFromContext(c), workspaceId, workspaceRuntimeId)
    return c.json(
      await runWorkspaceRuntimeRequest({
        userId,
        run: async () =>
          await readWorkspaceDirectoryOverview(workspaceId, {
            workspaceRuntimeId,
            signal: c.req.raw.signal,
          }),
        label: 'directory-overview',
        signal: c.req.raw.signal,
      }),
    )
  })

  app.post('/tree', async (c) => {
    const { target, prefix } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.tree, c)
    const executionTarget = requiredFilesystemExecutionTarget(target)
    const userId = requireCurrentWorkspaceRuntime(
      userIdFromContext(c),
      executionTarget.workspaceId,
      executionTarget.workspaceRuntimeId,
    )
    return c.json(
      await runWorkspaceRuntimeRequest({
        userId,
        run: async () =>
          await readWorkspaceFilesystemTree(executionTarget, {
            prefix,
            signal: c.req.raw.signal,
          }),
        label: 'tree',
        signal: c.req.raw.signal,
      }),
    )
  })

  app.post('/file-viewer', async (c) => {
    const { target } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.fileViewer, c)
    const executionTarget = requiredFilesystemExecutionTarget(target)
    const userId = requireCurrentWorkspaceRuntime(
      userIdFromContext(c),
      executionTarget.workspaceId,
      executionTarget.workspaceRuntimeId,
    )
    return c.json(
      await runWorkspaceRuntimeRequest({
        userId,
        run: async () => await readWorkspaceFileViewer(executionTarget, c.req.raw.signal),
        label: 'file-viewer',
        signal: c.req.raw.signal,
      }),
    )
  })

  app.post('/trash-file', async (c) => {
    const { target, path } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.trashFile, c)
    const executionTarget = requiredFilesystemExecutionTarget(target)
    const userId = requireCurrentWorkspaceRuntime(
      userIdFromContext(c),
      executionTarget.workspaceId,
      executionTarget.workspaceRuntimeId,
    )
    const result = await runWorkspaceRuntimeRequest({
      userId,
      run: async () => await trashWorkspaceFile(executionTarget, path, c.req.raw.signal),
      label: 'trash-file',
      signal: c.req.raw.signal,
    })
    if (result.ok || result.repositoryStateChanged === true) {
      publishUserWorkspaceFilesystemInvalidation(userId, { target: executionTarget })
    }
    if (executionTarget.kind === 'git-worktree' && (result.ok || result.repositoryStateChanged === true)) {
      publishUserRepoQueryInvalidation(userId, {
        repoId: executionTarget.workspaceId,
        query: 'repo-worktree-snapshot',
      })
    }
    return c.json(result)
  })

  app.post('/open-terminal', async (c) => {
    const { target, app: terminalApp } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.openTerminal, c)
    const executionTarget = requiredFilesystemExecutionTarget(target)
    const userId = requireCurrentWorkspaceRuntime(
      userIdFromContext(c),
      executionTarget.workspaceId,
      executionTarget.workspaceRuntimeId,
    )
    return c.json(
      await runWorkspaceRuntimeRequest({
        userId,
        run: async () => await openWorkspaceTerminal(executionTarget, terminalApp, c.req.raw.signal),
        label: 'open-terminal',
        signal: c.req.raw.signal,
      }),
    )
  })

  app.post('/open-editor', async (c) => {
    const { target, app: editorApp } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.openEditor, c)
    const executionTarget = requiredFilesystemExecutionTarget(target)
    const userId = requireCurrentWorkspaceRuntime(
      userIdFromContext(c),
      executionTarget.workspaceId,
      executionTarget.workspaceRuntimeId,
    )
    return c.json(
      await runWorkspaceRuntimeRequest({
        userId,
        run: async () => await openWorkspaceEditor(executionTarget, editorApp, c.req.raw.signal),
        label: 'open-editor',
        signal: c.req.raw.signal,
      }),
    )
  })

  app.post('/open-in-finder', async (c) => {
    const { target } = await parseHttpBody(WORKSPACE_PROCEDURE_SCHEMAS.openInFinder, c)
    const executionTarget = requiredFilesystemExecutionTarget(target)
    const userId = requireCurrentWorkspaceRuntime(
      userIdFromContext(c),
      executionTarget.workspaceId,
      executionTarget.workspaceRuntimeId,
    )
    return c.json(
      await runWorkspaceRuntimeRequest({
        userId,
        run: async () => await openWorkspaceInFinder(executionTarget, c.req.raw.signal),
        label: 'open-in-finder',
        signal: c.req.raw.signal,
      }),
    )
  })

  return app
}

function requireUserId(userId: string | null | undefined): string {
  if (!userId) throw new IpcError({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
  return userId
}

function requiredFilesystemExecutionTarget(target: RuntimeWorkspacePaneTarget): WorkspacePaneFilesystemExecutionTarget {
  const canonical = canonicalRuntimeWorkspacePaneTarget(target)
  if (!canonical || canonical.kind === 'git-branch') {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-target-transport-mismatch' })
  }
  return canonical
}

function serverLocatorPlatform(): WorkspaceLocatorPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix'
}
