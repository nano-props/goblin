// Read orchestration for the worktree-scoped lazy file tree (docs/filetree.md).
//
// This hook owns server data only: root/child reads, lazy merge state,
// invalidation, and restored expanded-directory loading. Persisted UI
// interaction state stays in the filetree interaction store.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  readCurrentWorkspaceFilesystemTree,
  subscribeWorkspaceFilesystemQueryInvalidationConsumer,
  workspaceFilesystemTreeChildrenQueryKey,
} from '#/web/workspace-filesystem-query.ts'
import {
  emptyLazyWorkspaceFilesystemTreeState,
  lazyWorkspaceFilesystemTreeReducer,
  type LazyWorkspaceFilesystemTreeAggregate,
  type LazyWorkspaceFilesystemTreeState,
} from '#/web/workspace-filesystem-lazy-state.ts'
import type { WorkspaceFilesystemTreeResult } from '#/shared/api-types.ts'
import {
  workspacePaneFilesystemExecutionPath,
  type WorkspacePaneFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'

export interface UseWorkspaceFilesystemTreeInput {
  readonly target: WorkspacePaneFilesystemExecutionTarget
  readonly expandedKeys?: readonly string[]
}

export interface UseWorkspaceFilesystemTreeResult {
  readonly tree: LazyWorkspaceFilesystemTreeAggregate | null
  readonly loading: boolean
  readonly error: string | null
  readonly loadingKeys: ReadonlySet<string>
  readonly errorKeys: ReadonlySet<string>
  readonly loadedPrefixes: ReadonlySet<string>
  loadChildren(prefix: string): Promise<void>
  refresh(): void
}

type ChildLoadMode = 'manual' | 'restore'

const EMPTY_EXPANDED_KEYS: readonly string[] = []

interface CachedWorkspaceFilesystemTreeStateInput {
  readonly queryClient: QueryClient
  readonly target: WorkspacePaneFilesystemExecutionTarget
  readonly expandedKeys: readonly string[]
}

export function useWorkspaceFilesystemTree(input: UseWorkspaceFilesystemTreeInput): UseWorkspaceFilesystemTreeResult {
  const inputTarget = input.target
  const inputTargetRoot = inputTarget.kind === 'workspace-root' ? inputTarget.workspaceId : inputTarget.root
  const target = useMemo(
    () => inputTarget,
    [inputTarget.kind, inputTarget.workspaceId, inputTarget.workspaceRuntimeId, inputTargetRoot],
  )
  const workspaceId = target.workspaceId
  const workspaceRuntimeId = target.workspaceRuntimeId
  const filesystemRootPath = workspacePaneFilesystemExecutionPath(target)
  const expandedKeys = input.expandedKeys ?? EMPTY_EXPANDED_KEYS
  const queryClient = useQueryClient()
  const enabled = workspaceId.length > 0 && workspaceRuntimeId.length > 0 && filesystemRootPath.length > 0
  const rootQueryKey = useMemo(
    () => workspaceFilesystemTreeChildrenQueryKey(target, ''),
    [target.kind, workspaceId, workspaceRuntimeId, filesystemRootPath],
  )
  const expandedKeysCacheSignal = useMemo(() => expandedKeys.map(normalizePrefix).join('\0'), [expandedKeys])
  const cachedExpandedPrefixes = useMemo(() => cachedPrefixesForExpandedKeys(expandedKeys), [expandedKeysCacheSignal])
  const [treeState, dispatchTreeState] = useReducer(
    lazyWorkspaceFilesystemTreeReducer,
    { queryClient, target, expandedKeys },
    cachedWorkspaceFilesystemTreeState,
  )
  const expandedKeysRef = useRef(expandedKeys)
  const readChildrenRef = useRef<(prefix: string, mode: ChildLoadMode) => Promise<void>>(async () => {})

  const rootQuery = useQuery({
    queryKey: rootQueryKey,
    enabled,
    // The query cache owns this root read across transient panel observer lifetimes.
    // Runtime identity is part of the key and the server rejects stale runtimes, so
    // aborting when a tab briefly remounts only creates duplicate replacement reads.
    queryFn: () => readCurrentWorkspaceFilesystemTree(queryClient, target, {}),
    retry: false,
    staleTime: Infinity,
  })
  const { data: rootData, error: rootError, isPending, refetch } = rootQuery

  useEffect(() => {
    return subscribeWorkspaceFilesystemQueryInvalidationConsumer(queryClient, (invalidatedTarget) => {
      if (!sameFilesystemExecutionTarget(invalidatedTarget, target)) return
      dispatchTreeState({ type: 'markForReload' })
    })
  }, [queryClient, target])

  useEffect(() => {
    expandedKeysRef.current = expandedKeys
  }, [expandedKeysCacheSignal, expandedKeys])

  useEffect(() => {
    dispatchTreeState({
      type: 'replace',
      state: cachedWorkspaceFilesystemTreeState({
        queryClient,
        target,
        expandedKeys: expandedKeysRef.current,
      }),
    })
  }, [queryClient, target, workspaceId, workspaceRuntimeId, filesystemRootPath])

  useEffect(() => {
    if (!enabled) return
    for (const prefix of cachedExpandedPrefixes) {
      const result = queryClient.getQueryData<WorkspaceFilesystemTreeResult>(
        workspaceFilesystemTreeChildrenQueryKey(target, prefix),
      )
      if (!result) continue
      dispatchTreeState({ type: 'childrenLoaded', prefix, result })
    }
  }, [cachedExpandedPrefixes, enabled, queryClient, target, workspaceId, workspaceRuntimeId, filesystemRootPath])

  useEffect(() => {
    if (!rootData) return
    dispatchTreeState({ type: 'childrenLoaded', prefix: '', result: rootData })
  }, [rootData])

  const readChildren = useCallback(
    async (prefix: string, mode: ChildLoadMode) => {
      if (!enabled) return
      const normalizedPrefix = normalizePrefix(prefix)
      if (treeState.loadedPrefixes.has(normalizedPrefix)) return
      if (treeState.loadingPrefixes.has(normalizedPrefix)) return
      if (mode === 'restore' && treeState.errorPrefixes.has(normalizedPrefix)) return

      dispatchTreeState({ type: 'childrenLoading', prefix: normalizedPrefix })
      try {
        const result = await queryClient.fetchQuery({
          queryKey: workspaceFilesystemTreeChildrenQueryKey(target, normalizedPrefix),
          queryFn: ({ signal }) =>
            readCurrentWorkspaceFilesystemTree(queryClient, target, {
              prefix: normalizedPrefix || undefined,
              signal,
            }),
          retry: false,
        })
        dispatchTreeState({ type: 'childrenLoaded', prefix: normalizedPrefix, result })
      } catch (err) {
        dispatchTreeState({ type: 'childrenFailed', prefix: normalizedPrefix })
        throw err
      } finally {
        dispatchTreeState({ type: 'childrenSettled', prefix: normalizedPrefix })
      }
    },
    [
      enabled,
      queryClient,
      workspaceId,
      workspaceRuntimeId,
      treeState.errorPrefixes,
      treeState.loadedPrefixes,
      treeState.loadingPrefixes,
      filesystemRootPath,
      target,
    ],
  )

  const loadChildren = useCallback(
    async (prefix: string) => {
      await readChildren(prefix, 'manual')
    },
    [readChildren],
  )

  useEffect(() => {
    readChildrenRef.current = readChildren
  }, [readChildren])

  useEffect(() => {
    if (!rootData) return
    for (const key of expandedKeys) void readChildrenRef.current(key, 'restore').catch(() => {})
  }, [expandedKeysCacheSignal, rootData, treeState.reloadEpoch])

  const refresh = useCallback(() => {
    if (!enabled) return
    dispatchTreeState({ type: 'markForReload' })
    void refetch()
  }, [enabled, refetch])

  return {
    tree: rootData ? treeState.result : null,
    loading: isPending,
    error: rootError instanceof Error ? rootError.message : rootError ? String(rootError) : null,
    loadingKeys: treeState.loadingPrefixes,
    errorKeys: treeState.errorPrefixes,
    loadedPrefixes: treeState.loadedPrefixes,
    loadChildren,
    refresh,
  }
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\.\/+/, '').replace(/\/+$/u, '')
}

function cachedWorkspaceFilesystemTreeState({
  queryClient,
  target,
  expandedKeys,
}: CachedWorkspaceFilesystemTreeStateInput): LazyWorkspaceFilesystemTreeState {
  let state = emptyLazyWorkspaceFilesystemTreeState()
  for (const prefix of cachedPrefixesForExpandedKeys(expandedKeys)) {
    const result = queryClient.getQueryData<WorkspaceFilesystemTreeResult>(
      workspaceFilesystemTreeChildrenQueryKey(target, prefix),
    )
    if (!result) continue
    state = lazyWorkspaceFilesystemTreeReducer(state, { type: 'childrenLoaded', prefix, result })
  }
  return state
}

function cachedPrefixesForExpandedKeys(expandedKeys: readonly string[]): readonly string[] {
  const prefixes = new Set<string>([''])
  for (const key of expandedKeys) {
    const normalizedKey = normalizePrefix(key)
    if (!normalizedKey) continue
    for (const prefix of ancestorAndSelfPrefixes(normalizedKey)) prefixes.add(prefix)
  }
  return Array.from(prefixes).sort((a, b) => prefixDepth(a) - prefixDepth(b) || a.localeCompare(b))
}

function ancestorAndSelfPrefixes(key: string): readonly string[] {
  const parts = key.split('/').filter(Boolean)
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'))
}

function prefixDepth(prefix: string): number {
  return prefix === '' ? 0 : prefix.split('/').length
}

function sameFilesystemExecutionTarget(
  left: WorkspacePaneFilesystemExecutionTarget,
  right: WorkspacePaneFilesystemExecutionTarget,
): boolean {
  return (
    left.kind === right.kind &&
    left.workspaceId === right.workspaceId &&
    left.workspaceRuntimeId === right.workspaceRuntimeId &&
    (left.kind === 'workspace-root' || (right.kind === 'git-worktree' && left.root === right.root))
  )
}
