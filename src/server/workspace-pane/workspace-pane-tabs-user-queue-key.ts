/**
 * Per-(user, scope) identifier for the server-side workspace-pane-tabs
 * operation queue. A scope is a server-owned runtime boundary (repo runtime
 * today). Listing tabs can canonicalize multiple targets in the same scope, so
 * all writes for that scope must share one queue.
 */
export function workspacePaneTabsUserScopeQueueKey(userId: string | number, scope: string): string {
  return `${String(userId)}\0scope\0${scope}`
}
