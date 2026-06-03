import { getEmbeddedServerRuntime } from '#/main/server-manager.ts'
import { invokeEmbeddedServerRpc, type EmbeddedServerRuntime } from '#/shared/embedded-server-client.ts'
import type { EmbeddedServerRpcPath } from '#/shared/embedded-server-rpc-routes.ts'
import { RpcError, type AppRpcHandlers } from '#/shared/rpc.ts'

function getEmbeddedServerRuntimeOrThrow(): EmbeddedServerRuntime {
  const runtime = getEmbeddedServerRuntime()
  if (!runtime) throw new RpcError({ code: 'INTERNAL_SERVER_ERROR', message: 'Embedded server unavailable' })
  return runtime
}

export function createEmbeddedServerRepoRpcProxyHandlers(
  getSignal?: () => AbortSignal | undefined,
): AppRpcHandlers['repo'] {
  const call = <T>(path: EmbeddedServerRpcPath, input?: object) =>
    invokeEmbeddedServerRpc<T>(getEmbeddedServerRuntimeOrThrow(), path, input, { signal: getSignal?.() })
  return {
    probe: async ({ cwd }) => call('repo.probe', { cwd }),
    clone: async ({ operationId, url, parentPath, directoryName }) =>
      call('repo.clone', { operationId, url, parentPath, directoryName }),
    abortClone: async ({ operationId }) => call('repo.abortClone', { operationId }),
    snapshot: async ({ cwd }) => call('repo.snapshot', { cwd }),
    pullRequests: async ({ cwd, branches, options }) => call('repo.pullRequests', { cwd, branches, options }),
    status: async ({ cwd }) => call('repo.status', { cwd }),
    patch: async ({ cwd, worktreePath }) => call('repo.patch', { cwd, worktreePath }),
    checkout: async ({ cwd, branch }) => call('repo.checkout', { cwd, branch }),
    deleteBranch: async ({ cwd, branch, force, alsoDeleteUpstream }) =>
      call('repo.deleteBranch', { cwd, branch, force, alsoDeleteUpstream }),
    removeWorktree: async ({ cwd, branch, worktreePath, alsoDeleteBranch, forceDeleteBranch, alsoDeleteUpstream }) =>
      call('repo.removeWorktree', {
        cwd,
        branch,
        worktreePath,
        alsoDeleteBranch,
        forceDeleteBranch,
        alsoDeleteUpstream,
      }),
    createWorktree: async ({ cwd, worktreePath, newBranch, baseBranch }) =>
      call('repo.createWorktree', { cwd, worktreePath, newBranch, baseBranch }),
    pull: async ({ cwd, branch, worktreePath }) => call('repo.pull', { cwd, branch, worktreePath }),
    push: async ({ cwd, branch }) => call('repo.push', { cwd, branch }),
    fetch: async ({ cwd, kind }) => call('repo.fetch', { cwd, kind }),
    abort: async ({ cwd }) => call('repo.abort', { cwd }),
    openRemote: async ({ cwd, branch }) => call('repo.openRemote', branch ? { cwd, branch } : { cwd }),
  }
}

export function createEmbeddedServerRemoteRpcProxyHandlers(
  getSignal?: () => AbortSignal | undefined,
): AppRpcHandlers['remote'] {
  const call = <T>(path: EmbeddedServerRpcPath, input?: object) =>
    invokeEmbeddedServerRpc<T>(getEmbeddedServerRuntimeOrThrow(), path, input, { signal: getSignal?.() })
  return {
    listSshHosts: async () => call('remote.listSshHosts'),
    resolveTarget: async (input) => call('remote.resolveTarget', input),
    listPathSuggestions: async (input) => call('remote.listPathSuggestions', input),
    testRepository: async ({ target }) => call('remote.testRepository', { target }),
  }
}
