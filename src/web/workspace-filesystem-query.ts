import { hashKey, type QueryClient } from '@tanstack/react-query'
import type { WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'
import {
  workspacePaneFilesystemExecutionPath,
  type WorkspacePaneFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'
import { getWorkspaceFilesystemTree } from '#/web/workspace-filesystem-client.ts'
import { subscribeWorkspaceFilesystemInvalidation } from '#/web/workspace-filesystem-invalidation-ingress.ts'

const invalidationVersionsByClient = new WeakMap<QueryClient, Map<string, number>>()
const invalidationSyncByClient = new WeakMap<QueryClient, { references: number; stop: () => void }>()

export function workspaceFilesystemTreeChildrenQueryKey(
  target: WorkspacePaneFilesystemExecutionTarget,
  prefix: string,
) {
  return [
    'workspace-filesystem-children',
    target.workspaceId,
    target.workspaceRuntimeId,
    target.kind,
    target.kind === 'workspace-root' ? target.workspaceId : target.root,
    workspacePaneFilesystemExecutionPath(target),
    prefix,
  ] as const
}

export function startWorkspaceFilesystemQueryInvalidationSync(queryClient: QueryClient): () => void {
  let sync = invalidationSyncByClient.get(queryClient)
  if (!sync) {
    const unsubscribeIngress = subscribeWorkspaceFilesystemInvalidation((event) => {
      const queryPrefix = workspaceFilesystemTreeQueryPrefix(event.target)
      if (queryClient.getQueryCache().findAll({ queryKey: queryPrefix }).length === 0) return
      bumpInvalidationVersion(queryClient, event.target)
      void queryClient.invalidateQueries({ queryKey: queryPrefix, refetchType: 'active' }, { cancelRefetch: false })
    })
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'removed') return
      const queryKey = event.query.queryKey
      if (queryKey[0] !== 'workspace-filesystem-children' || queryKey.length !== 7) return
      const targetKey = queryKey.slice(0, -1)
      if (queryClient.getQueryCache().findAll({ queryKey: targetKey }).length > 0) return
      invalidationVersionsByClient.get(queryClient)?.delete(hashKey(targetKey))
    })
    sync = {
      references: 0,
      stop: () => {
        unsubscribeIngress()
        unsubscribeCache()
      },
    }
    invalidationSyncByClient.set(queryClient, sync)
  }
  sync.references += 1
  return () => {
    const current = invalidationSyncByClient.get(queryClient)
    if (!current) return
    current.references -= 1
    if (current.references > 0) return
    current.stop()
    invalidationSyncByClient.delete(queryClient)
    invalidationVersionsByClient.delete(queryClient)
  }
}

export function subscribeWorkspaceFilesystemRootReloadStart(
  queryClient: QueryClient,
  target: WorkspacePaneFilesystemExecutionTarget,
  consumer: () => void,
): () => void {
  const rootQueryHash = hashKey(workspaceFilesystemTreeChildrenQueryKey(target, ''))
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryHash !== rootQueryHash) return
    if (event.action.type === 'fetch') consumer()
    if (event.action.type === 'invalidate' && event.query.state.fetchStatus === 'fetching') consumer()
  })
}

export async function readCurrentWorkspaceFilesystemTree(
  queryClient: QueryClient,
  target: WorkspacePaneFilesystemExecutionTarget,
  options: { prefix?: string; signal?: AbortSignal },
): Promise<WorkspaceFilesystemTreeResult> {
  for (;;) {
    options.signal?.throwIfAborted()
    const version = invalidationVersion(queryClient, target)
    const result = await getWorkspaceFilesystemTree(target, options)
    options.signal?.throwIfAborted()
    if (version === invalidationVersion(queryClient, target)) return result
  }
}

function bumpInvalidationVersion(queryClient: QueryClient, target: WorkspacePaneFilesystemExecutionTarget): void {
  const versions = invalidationVersionMap(queryClient)
  const key = invalidationVersionKey(target)
  versions.set(key, (versions.get(key) ?? 0) + 1)
}

function invalidationVersion(queryClient: QueryClient, target: WorkspacePaneFilesystemExecutionTarget): number {
  return invalidationVersionMap(queryClient).get(invalidationVersionKey(target)) ?? 0
}

function invalidationVersionMap(queryClient: QueryClient): Map<string, number> {
  let versions = invalidationVersionsByClient.get(queryClient)
  if (!versions) {
    versions = new Map()
    invalidationVersionsByClient.set(queryClient, versions)
  }
  return versions
}

function invalidationVersionKey(target: WorkspacePaneFilesystemExecutionTarget): string {
  return hashKey(workspaceFilesystemTreeQueryPrefix(target))
}

function workspaceFilesystemTreeQueryPrefix(target: WorkspacePaneFilesystemExecutionTarget): readonly unknown[] {
  return workspaceFilesystemTreeChildrenQueryKey(target, '').slice(0, -1)
}
