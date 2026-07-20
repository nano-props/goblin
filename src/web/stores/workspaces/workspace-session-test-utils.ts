import {
  normalizeRemoteWorkspaceId,
  type WorkspaceSessionEntry,
  type RemoteWorkspaceTarget,
} from '#/shared/remote-workspace.ts'
import {
  resolveServerRemoteWorkspaceConnection,
  type RemoteWorkspaceConnectionDeps,
} from '#/server/modules/remote-workspace.ts'
import { createBranchSnapshot, installGoblinTestBridge, resetWorkspacesStore } from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { flushMicrotasks } from '#/test-utils/index.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
export const REPO_A = workspaceIdForTest('goblin+file:///tmp/goblin-lifecycle-a')
export const REPO_B = workspaceIdForTest('goblin+file:///tmp/goblin-lifecycle-b')
export const branchSnapshot = createBranchSnapshot

export async function flushIpc(): Promise<void> {
  await flushMicrotasks(5)
}

export function installGoblin(overrides: Record<string, (input: any) => unknown> = {}) {
  const calls = {
    recent: [] as WorkspaceSessionEntry[],
    workspaceEntries: [] as WorkspaceSessionEntry[],
    projection: [] as string[],
    resolveTarget: [] as Array<{ alias: string; remotePath: string }>,
  }
  const handlers: Record<string, (input: any) => unknown> = {
    'workspace.probe': ({ workspaceInput }: { workspaceInput: string }): WorkspaceSettledProbeState => {
      if (workspaceInput === '/missing') return { status: 'unavailable', reason: 'error.workspace-path-not-found' }
      return {
        status: 'ready',
        name: workspaceInput.split('/').at(-1) ?? workspaceInput,
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
        },
        diagnostics: [],
      }
    },
    'repo.projection': ({ cwd }: { cwd: string }) => {
      calls.projection.push(cwd)
      return { snapshot: { branches: [], current: '' }, pullRequests: null }
    },
    'repo.worktreeStatus': ({ workspaceRuntimeId }: { workspaceRuntimeId: string }) => ({
      workspaceRuntimeId,
      status: [],
      loadedAt: Date.now(),
    }),
    'remote.resolveTarget': ({ alias, remotePath }: { alias: string; remotePath: string }) => {
      calls.resolveTarget.push({ alias, remotePath })
      return {
        target: {
          id: normalizeRemoteWorkspaceId({ alias, remotePath }),
          alias,
          host: alias === 'example' ? 'example.com' : `${alias}.example.com`,
          user: 'alice',
          port: 22,
          remotePath,
          displayName: `${alias}:${remotePath.split('/').at(-1) || '/'}`,
        },
      }
    },
    'settings.addRecentWorkspace': ({ workspace }: { workspace: WorkspaceSessionEntry }) => {
      calls.recent.push(workspace)
      return calls.recent
    },
    'settings.addWorkspaceEntry': ({ entry }: { entry: WorkspaceSessionEntry }) => {
      const existingIndex = calls.workspaceEntries.findIndex((candidate) => candidate.id === entry.id)
      if (existingIndex === -1) calls.workspaceEntries.push(entry)
      else calls.workspaceEntries[existingIndex] = entry
      return undefined
    },
    'settings.removeWorkspaceEntry': ({ workspaceId }: { workspaceId: string }) => {
      const index = calls.workspaceEntries.findIndex((entry) => entry.id === workspaceId)
      if (index !== -1) calls.workspaceEntries.splice(index, 1)
      return undefined
    },
    'settings.applyNativeHostProjection': async () => undefined,
  }
  for (const [key, handler] of Object.entries(overrides)) {
    if (key === 'workspaceProbe') {
      handlers['workspace.probe'] = ({ workspaceInput }: { workspaceInput: string }) => handler(workspaceInput)
    } else if (key === 'projection') handlers['repo.projection'] = handler
    else handlers[key] = handler
  }
  // Exercise the same server-side lifecycle boundary used in production:
  // inject test doubles into `resolveServerRemoteWorkspaceConnection` so the
  // real classification / mapping code runs in tests.
  const deps: RemoteWorkspaceConnectionDeps = {
    resolveTarget: async ({ alias, remotePath }) => {
      const result = handlers['remote.resolveTarget']?.({ alias, remotePath }) as
        { target: RemoteWorkspaceTarget; error?: undefined } | { error: string; target?: undefined } | undefined
      if (!result) return { error: 'missing-resolve-target' }
      if ('target' in result && result.target !== undefined) return { target: result.target }
      return { error: result.error ?? 'resolve-target-error' }
    },
    probeRemote: async (target, { signal: _signal }) => {
      const parsed = handlers['workspace.probe']?.({ workspaceInput: target.id }) as
        WorkspaceSettledProbeState | undefined
      if (!parsed) return { ok: false, message: 'missing-probe' }
      if (parsed.status === 'unavailable') return { ok: false, message: parsed.reason }
      return { ok: true }
    },
  }
  if (!overrides['remote.lifecycle']) {
    handlers['remote.lifecycle'] = async ({ workspaceId }: { workspaceId: string; workspaceRuntimeId: string }) => {
      const canonicalWorkspaceId = workspaceIdForTest(workspaceId)
      const result = await resolveServerRemoteWorkspaceConnection(
        { workspaceId: canonicalWorkspaceId },
        undefined,
        deps,
      )
      return result.kind === 'ready'
        ? {
            kind: 'settled',
            workspaceId: canonicalWorkspaceId,
            name: result.name,
            lifecycle: { ...result.lifecycle, attemptId: 1 },
          }
        : {
            kind: 'settled',
            workspaceId: canonicalWorkspaceId,
            name: result.name,
            lifecycle: { ...result.lifecycle, attemptId: 1 },
          }
    }
  }
  installGoblinTestBridge(handlers)
  return calls
}

export function resetLifecycleTest(): void {
  resetWorkspacesStore()
  primaryWindowQueryClient.clear()
}
