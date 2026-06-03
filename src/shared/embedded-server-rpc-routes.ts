export const EMBEDDED_SERVER_RPC_ROUTES = {
  'repo.probe': { route: '/api/repo/probe', method: 'POST' },
  'repo.clone': { route: '/api/repo/clone', method: 'POST' },
  'repo.abortClone': { route: '/api/repo/abort-clone', method: 'POST' },
  'repo.snapshot': { route: '/api/repo/snapshot', method: 'POST' },
  'repo.pullRequests': { route: '/api/repo/pull-requests', method: 'POST' },
  'repo.status': { route: '/api/repo/status', method: 'POST' },
  'repo.patch': { route: '/api/repo/patch', method: 'POST' },
  'repo.checkout': { route: '/api/repo/checkout', method: 'POST' },
  'repo.deleteBranch': { route: '/api/repo/delete-branch', method: 'POST' },
  'repo.removeWorktree': { route: '/api/repo/remove-worktree', method: 'POST' },
  'repo.createWorktree': { route: '/api/repo/create-worktree', method: 'POST' },
  'repo.pull': { route: '/api/repo/pull', method: 'POST' },
  'repo.push': { route: '/api/repo/push', method: 'POST' },
  'repo.fetch': { route: '/api/repo/fetch', method: 'POST' },
  'repo.abort': { route: '/api/repo/abort', method: 'POST' },
  'repo.openRemote': { route: '/api/repo/open-remote', method: 'POST' },
  'remote.listSshHosts': { route: '/api/remote/ssh-hosts', method: 'GET' },
  'remote.resolveTarget': { route: '/api/remote/resolve-target', method: 'POST' },
  'remote.listPathSuggestions': { route: '/api/remote/path-suggestions', method: 'POST' },
  'remote.testRepository': { route: '/api/remote/test-repository', method: 'POST' },
} as const

export type EmbeddedServerRpcPath = keyof typeof EMBEDDED_SERVER_RPC_ROUTES

export function getEmbeddedServerRpcRoute(path: string): (typeof EMBEDDED_SERVER_RPC_ROUTES)[EmbeddedServerRpcPath] | null {
  return path in EMBEDDED_SERVER_RPC_ROUTES
    ? EMBEDDED_SERVER_RPC_ROUTES[path as EmbeddedServerRpcPath]
    : null
}
