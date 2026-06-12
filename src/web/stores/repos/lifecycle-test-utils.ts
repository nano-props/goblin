import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { createBranchSnapshot, installGoblinTestBridge, resetReposStore } from '#/web/stores/repos/test-utils.ts'
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
    'settings.applyShellProjection': async () => undefined,
  }
  for (const [key, handler] of Object.entries(overrides)) {
    if (key === 'probe') handlers['repo.probe'] = ({ cwd }: { cwd: string }) => handler(cwd)
    else if (key === 'snapshot') handlers['repo.snapshot'] = ({ cwd }: { cwd: string }) => handler(cwd)
    else handlers[key] = handler
  }
  installGoblinTestBridge(handlers)
  return calls
}

export function resetLifecycleTest(): void {
  resetReposStore()
}
