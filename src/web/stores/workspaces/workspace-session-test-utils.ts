import { normalizeRemoteRepoId, type WorkspaceSessionEntry, type RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { resolveServerRemoteRepoConnection, type RemoteRepoConnectionDeps } from '#/server/modules/remote.ts'
import { createBranchSnapshot, installGoblinTestBridge, resetWorkspacesStore } from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { flushMicrotasks } from '#/test-utils/index.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
export const REPO_A = workspaceIdForTest('goblin+file:///tmp/goblin-lifecycle-a')
export const REPO_B = workspaceIdForTest('goblin+file:///tmp/goblin-lifecycle-b')
export const branchSnapshot = createBranchSnapshot

export async function flushIpc(): Promise<void> {
  await flushMicrotasks(5)
}

export function installGoblin(overrides: Record<string, (input: any) => unknown> = {}) {
  const calls = {
    recent: [] as WorkspaceSessionEntry[],
    workspaceRepos: [] as WorkspaceSessionEntry[],
    projection: [] as string[],
    resolveTarget: [] as Array<{ alias: string; remotePath: string }>,
  }
  const handlers: Record<string, (input: any) => unknown> = {
    'repo.probe': ({ cwd }: { cwd: string }) => {
      if (cwd === '/missing') return { ok: false, message: 'missing' }
      return { ok: true, root: cwd, name: cwd.split('/').at(-1) ?? cwd }
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
    'repo.abort': async () => undefined,
    'remote.resolveTarget': ({ alias, remotePath }: { alias: string; remotePath: string }) => {
      calls.resolveTarget.push({ alias, remotePath })
      return {
        target: {
          id: normalizeRemoteRepoId({ alias, remotePath }),
          alias,
          host: alias === 'example' ? 'example.com' : `${alias}.example.com`,
          user: 'alice',
          port: 22,
          remotePath,
          displayName: `${alias}:${remotePath.split('/').at(-1) || '/'}`,
        },
      }
    },
    'settings.addRecentWorkspace': ({ repo }: { repo: WorkspaceSessionEntry }) => {
      calls.recent.push(repo)
      return calls.recent
    },
    'settings.addWorkspaceRepo': ({ entry }: { entry: WorkspaceSessionEntry }) => {
      const existingIndex = calls.workspaceRepos.findIndex((candidate) => candidate.id === entry.id)
      if (existingIndex === -1) calls.workspaceRepos.push(entry)
      else calls.workspaceRepos[existingIndex] = entry
      return undefined
    },
    'settings.removeWorkspaceRepo': ({ repoRoot }: { repoRoot: string }) => {
      const index = calls.workspaceRepos.findIndex((entry) => entry.id === repoRoot)
      if (index !== -1) calls.workspaceRepos.splice(index, 1)
      return undefined
    },
    'settings.applyNativeHostProjection': async () => undefined,
  }
  for (const [key, handler] of Object.entries(overrides)) {
    if (key === 'probe') handlers['repo.probe'] = ({ cwd }: { cwd: string }) => handler(cwd)
    else if (key === 'projection') handlers['repo.projection'] = handler
    else handlers[key] = handler
  }
  // Exercise the same server-side lifecycle boundary used in production:
  // inject test doubles into `resolveServerRemoteRepoConnection` so the
  // real classification / mapping code runs in tests.
  const deps: RemoteRepoConnectionDeps = {
    resolveTarget: async ({ alias, remotePath }) => {
      const result = handlers['remote.resolveTarget']?.({ alias, remotePath }) as
        { target: RemoteRepoTarget; error?: undefined } | { error: string; target?: undefined } | undefined
      if (!result) return { error: 'missing-resolve-target' }
      if ('target' in result && result.target !== undefined) return { target: result.target }
      return { error: result.error ?? 'resolve-target-error' }
    },
    probeRemote: async (target, { signal: _signal }) => {
      const parsed = handlers['repo.probe']?.({ cwd: target.remotePath }) as
        { ok: true; root?: string; name?: string } | { ok: false; message: string } | undefined
      if (!parsed) return { ok: false, message: 'missing-probe' }
      if (!parsed.ok) return { ok: false, message: parsed.message }
      return { ok: true }
    },
  }
  if (!overrides['remote.lifecycle']) {
    handlers['remote.lifecycle'] = async ({ repoId }: { repoId: string; workspaceRuntimeId: string }) => {
      const result = await resolveServerRemoteRepoConnection({ repoId }, undefined, deps)
      return result.kind === 'ready'
        ? {
            kind: 'settled',
            repoId: result.repoId,
            name: result.name,
            lifecycle: { ...result.lifecycle, attemptId: 1 },
          }
        : {
            kind: 'settled',
            repoId: result.repoId,
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
