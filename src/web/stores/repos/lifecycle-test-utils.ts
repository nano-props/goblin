import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { toRemoteRepoFailureReason } from '#/shared/remote-repo.ts'
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
    'settings.applyShellProjection': async () => undefined,
  }
  for (const [key, handler] of Object.entries(overrides)) {
    if (key === 'probe') handlers['repo.probe'] = ({ cwd }: { cwd: string }) => handler(cwd)
    else if (key === 'snapshot') handlers['repo.snapshot'] = ({ cwd }: { cwd: string }) => handler(cwd)
    else if (key === 'composite') handlers['repo.composite'] = handler
    else handlers[key] = handler
  }
  // Phase 3: unified server-side lifecycle boundary. Wired
  // AFTER the override pass so it can dynamically read the
  // (possibly-overridden) `remote.resolveTarget` and
  // `repo.probe` handlers. The mock composes them into a
  // converged `RemoteRepoLifecycleResult` (ready or failed,
  // never connecting) — same shape the real server returns.
  handlers['remote.lifecycle'] = ({ repoId }: { repoId: string }) => {
    // Step 1: server-side resolveTarget. The mock's resolveTarget
    // is called with the lifecycle's `alias` + `remotePath` (or
    // whatever the mock wants to look at — the production server
    // uses the id's parsed alias/remotePath). Tests can override
    // `remote.resolveTarget` to return different targets per
    // call; the lifecycle mock uses whatever it returns.
    const resolveResult = handlers['remote.resolveTarget']?.({ alias: 'example', remotePath: '/srv/repo' }) as
      | {
          target?: {
            id: string
            alias: string
            host: string
            user: string
            port: number
            remotePath: string
            displayName: string
          }
          error?: string
        }
      | undefined
    if (resolveResult?.error) {
      return {
        kind: 'failed',
        repoId,
        name: repoId,
        lifecycle: { kind: 'failed', reason: 'config-changed' },
      }
    }
    // Step 2: server-side probe.
    const probeResult = handlers['repo.probe']?.({ cwd: repoId }) as
      | { ok: boolean; root?: string; name?: string; message?: string }
      | undefined
    if (probeResult && probeResult.ok === false) {
      // The real server maps probe.message → RemoteRepoFailureReason
      // via `toRemoteRepoFailureReason`. The mock mirrors the
      // same mapping. The server-side composeTarget-then-probe
      // order means a failed probe STILL has the resolved
      // target — we forward it in `lifecycle.target` so the
      // UI keeps showing the remote locator on the failed tab.
      const failureTarget = resolveResult?.target
      return {
        kind: 'failed',
        repoId,
        name: probeResult.name ?? repoId,
        lifecycle: {
          kind: 'failed',
          reason: toRemoteRepoFailureReason(probeResult.message ?? 'unknown'),
          ...(failureTarget ? { target: failureTarget } : {}),
        },
      }
    }
    // The mock uses the resolved target (if the resolveTarget
    // mock produced one) so per-call target overrides propagate
    // through the lifecycle. Fall back to a hardcoded target
    // when the resolveTarget mock returns nothing.
    const target = resolveResult?.target ?? {
      id: repoId,
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'example:repo',
    }
    return {
      kind: 'ready',
      repoId,
      name: probeResult?.name ?? target.displayName,
      lifecycle: { kind: 'ready', target },
    }
  }
  installGoblinTestBridge(handlers)
  return calls
}

export function resetLifecycleTest(): void {
  resetReposStore()
}
