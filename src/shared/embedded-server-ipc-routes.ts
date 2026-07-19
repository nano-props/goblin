export const EMBEDDED_SERVER_IPC_ROUTES = {
  'repo.probe': { route: '/api/repo/probe', method: 'POST' },
  'repo.clone': { route: '/api/repo/clone', method: 'POST' },
  'repo.projection': { route: '/api/repo/projection', method: 'POST' },
  'repo.worktreeStatus': { route: '/api/repo/worktree-status', method: 'POST' },
  'repo.workspaceOverview': { route: '/api/repo/workspace-overview', method: 'POST' },
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
  'workspace.runtimeOpen': { route: '/api/workspace/runtime-open', method: 'POST' },
  'workspace.runtimeReconcile': { route: '/api/workspace/runtime-reconcile', method: 'POST' },
  'workspace.runtimeList': { route: '/api/workspace/runtime-list', method: 'POST' },
  'workspace.runtimeClose': { route: '/api/workspace/runtime-close', method: 'POST' },
  'repo.openUrl': { route: '/api/repo/open-url', method: 'POST' },
  'remote.listSshHosts': { route: '/api/remote/ssh-hosts', method: 'GET' },
  'remote.resolveTarget': { route: '/api/remote/resolve-target', method: 'POST' },
  'remote.listPathSuggestions': { route: '/api/remote/path-suggestions', method: 'POST' },
  'remote.testWorkspace': { route: '/api/remote/test-workspace', method: 'POST' },
} as const

export type EmbeddedServerIpcPath = keyof typeof EMBEDDED_SERVER_IPC_ROUTES

export function getEmbeddedServerIpcRoute(
  path: string,
): (typeof EMBEDDED_SERVER_IPC_ROUTES)[EmbeddedServerIpcPath] | null {
  return path in EMBEDDED_SERVER_IPC_ROUTES ? EMBEDDED_SERVER_IPC_ROUTES[path as EmbeddedServerIpcPath] : null
}
