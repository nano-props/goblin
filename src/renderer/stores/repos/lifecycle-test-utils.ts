import { createBranch, installGoblinTestBridge, resetReposStore } from '#/renderer/stores/repos/test-utils.ts'

export const REPO_A = '/tmp/gbl-lifecycle-a'
export const REPO_B = '/tmp/gbl-lifecycle-b'
export const branch = createBranch

export async function flushRpc(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

export function installGoblin(overrides: Record<string, (input: any) => unknown> = {}) {
  const calls = {
    recent: [] as string[],
    snapshot: [] as string[],
    status: [] as string[],
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
    'settings.addRecentRepo': ({ repoPath }: { repoPath: string }) => {
      calls.recent.push(repoPath)
      return calls.recent
    },
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
