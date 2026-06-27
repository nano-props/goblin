import type { RepoSessionEntry, RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { resolveServerRemoteRepoConnection, type RemoteRepoConnectionDeps } from '#/server/modules/remote.ts'
import { createBranchSnapshot, installGoblinTestBridge, resetReposStore } from '#/web/test-utils/bridge.ts'
export const REPO_A = '/tmp/gbl-lifecycle-a'
export const REPO_B = '/tmp/gbl-lifecycle-b'
export const branchSnapshot = createBranchSnapshot

export async function flushIpc(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

export function installGoblin(overrides: Record<string, (input: any) => unknown> = {}) {
  const calls = {
    recent: [] as RepoSessionEntry[],
    snapshot: [] as string[],
    status: [] as string[],
    composite: [] as string[],
    resolveTarget: [] as Array<{ alias: string; remotePath: string }>,
  }
  const handlers: Record<string, (input: any) => unknown> = {
    'repo.probe': ({ cwd }: { cwd: string }) => {
      if (cwd === '/missing') return { ok: false, message: 'missing' }
      return { ok: true, root: cwd, name: cwd.split('/').at(-1) ?? cwd }
    },
    'repo.snapshot': ({ cwd }: { cwd: string }) => {
      calls.snapshot.push(cwd)
      return { branches: [], current: '' }
    },
    'repo.pullRequests': async () => [],
    'repo.status': ({ cwd }: { cwd: string }) => {
      calls.status.push(cwd)
      return []
    },
    // The composite endpoint folds snapshot + status into one round
    // trip, so it lives in its own bucket — the old approach of
    // pushing into both `snapshot` and `status` hid the fact that
    // `refreshCoreData` now hits the bridge once, not twice.
    'repo.composite': ({ cwd }: { cwd: string }) => {
      calls.composite.push(cwd)
      return { snapshot: { branches: [], current: '' }, status: [], pullRequests: null }
    },
    'repo.abort': async () => undefined,
    'remote.resolveTarget': ({ alias, remotePath }: { alias: string; remotePath: string }) => {
      calls.resolveTarget.push({ alias, remotePath })
      return {
        target: {
          id: `ssh-config://${encodeURIComponent(alias)}${remotePath}`,
          alias,
          host: alias === 'example' ? 'example.com' : `${alias}.example.com`,
          user: 'alice',
          port: 22,
          remotePath,
          displayName: `${alias}:${remotePath.split('/').at(-1) || '/'}`,
        },
      }
    },
    'settings.addRecentRepo': ({ repo }: { repo: RepoSessionEntry }) => {
      calls.recent.push(repo)
      return calls.recent
    },
    'settings.applyNativeHostProjection': async () => undefined,
  }
  for (const [key, handler] of Object.entries(overrides)) {
    if (key === 'probe') handlers['repo.probe'] = ({ cwd }: { cwd: string }) => handler(cwd)
    else if (key === 'snapshot') handlers['repo.snapshot'] = ({ cwd }: { cwd: string }) => handler(cwd)
    else if (key === 'composite') handlers['repo.composite'] = handler
    else handlers[key] = handler
  }
  // Phase 3: unified server-side lifecycle boundary. Instead of
  // hand-rolling the same compose logic the server already owns,
  // we inject test doubles into the real `resolveServerRemoteRepoConnection`
  // so the exact same classification / mapping code runs in tests.
  const deps: RemoteRepoConnectionDeps = {
    resolveTarget: async ({ alias, remotePath }) => {
      const result = handlers['remote.resolveTarget']?.({ alias, remotePath }) as
        | { target: RemoteRepoTarget; error?: undefined }
        | { error: string; target?: undefined }
        | undefined
      if (!result) return { error: 'missing-resolve-target' }
      if ('target' in result && result.target !== undefined) return { target: result.target }
      return { error: result.error ?? 'resolve-target-error' }
    },
    probeRemote: async (target, { signal }) => {
      const parsed = handlers['repo.probe']?.({ cwd: target.remotePath }) as
        | { ok: true; root?: string; name?: string }
        | { ok: false; message: string }
        | undefined
      if (!parsed) return { ok: false, message: 'missing-probe' }
      if (!parsed.ok) return { ok: false, message: parsed.message }
      return { ok: true }
    },
  }
  handlers['remote.lifecycle'] = async ({ repoId }: { repoId: string }) => {
    return resolveServerRemoteRepoConnection({ repoId }, undefined, deps)
  }
  installGoblinTestBridge(handlers)
  return calls
}

export function resetLifecycleTest(): void {
  resetReposStore()
}
