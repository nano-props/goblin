export const EMBEDDED_SERVER_IPC_ROUTES = {
  'repo.probe': { route: '/api/repo/probe', method: 'POST' },
  'repo.clone': { route: '/api/repo/clone', method: 'POST' },
  'repo.projection': { route: '/api/repo/projection', method: 'POST' },
  'repo.worktreeStatus': { route: '/api/repo/worktree-status', method: 'POST' },
  'repo.operations': { route: '/api/repo/operations', method: 'POST' },
  'repo.patch': { route: '/api/repo/patch', method: 'POST' },
  'repo.deleteBranch': { route: '/api/repo/delete-branch', method: 'POST' },
  'repo.removeWorktree': { route: '/api/repo/remove-worktree', method: 'POST' },
  'repo.createWorktree': { route: '/api/repo/create-worktree', method: 'POST' },
  'repo.worktreeBootstrapPreview': { route: '/api/repo/worktree-bootstrap-preview', method: 'POST' },
  'repo.remoteBranches': { route: '/api/repo/remote-branches', method: 'POST' },
  'repo.pull': { route: '/api/repo/pull', method: 'POST' },
  'repo.push': { route: '/api/repo/push', method: 'POST' },
  'repo.fetch': { route: '/api/repo/fetch', method: 'POST' },
  'repo.runtimeOpen': { route: '/api/repo/runtime-open', method: 'POST' },
  'repo.runtimeReconcile': { route: '/api/repo/runtime-reconcile', method: 'POST' },
  'repo.runtimeList': { route: '/api/repo/runtime-list', method: 'POST' },
  'repo.runtimeClose': { route: '/api/repo/runtime-close', method: 'POST' },
  'repo.abort': { route: '/api/repo/abort', method: 'POST' },
  'repo.openUrl': { route: '/api/repo/open-url', method: 'POST' },
  'remote.listSshHosts': { route: '/api/remote/ssh-hosts', method: 'GET' },
  'remote.resolveTarget': { route: '/api/remote/resolve-target', method: 'POST' },
  'remote.listPathSuggestions': { route: '/api/remote/path-suggestions', method: 'POST' },
  'remote.testRepo': { route: '/api/remote/test-repo', method: 'POST' },
} as const

export type EmbeddedServerIpcPath = keyof typeof EMBEDDED_SERVER_IPC_ROUTES

export function getEmbeddedServerIpcRoute(
  path: string,
): (typeof EMBEDDED_SERVER_IPC_ROUTES)[EmbeddedServerIpcPath] | null {
  return path in EMBEDDED_SERVER_IPC_ROUTES ? EMBEDDED_SERVER_IPC_ROUTES[path as EmbeddedServerIpcPath] : null
}
