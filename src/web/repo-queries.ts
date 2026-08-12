import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import type { RepoPullRequestScope } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  repoLogQueryOptions,
  repoOperationsQueryOptions,
  repoPullRequestsQueryOptions,
  repoSnapshotQueryOptions,
  repoRemoteBranchesQueryOptions,
  repoWorktreeStatusQueryOptions,
} from '#/web/repo-query-options.ts'
import { projectRepoOperationsQueryData } from '#/web/repo-query-cache.ts'

export function useRepoSnapshotReadModel(
  repoRoot: MaybeRefOrGetter<WorkspaceId>,
  workspaceRuntimeId: MaybeRefOrGetter<string>,
  options: { enabled?: MaybeRefOrGetter<boolean | undefined> } = {},
) {
  return useQuery(
    computed(() => ({
      ...repoSnapshotQueryOptions(toValue(repoRoot), toValue(workspaceRuntimeId)),
      enabled: toValue(options.enabled) !== false,
    })),
  )
}

export function useRepoPullRequestsReadModel(
  repoRoot: MaybeRefOrGetter<WorkspaceId>,
  workspaceRuntimeId: MaybeRefOrGetter<string>,
  scope: MaybeRefOrGetter<RepoPullRequestScope>,
) {
  return useQuery(
    computed(() => repoPullRequestsQueryOptions(toValue(repoRoot), toValue(workspaceRuntimeId), toValue(scope))),
  )
}

export function useRepoWorktreeStatusReadModel(
  repoRoot: MaybeRefOrGetter<WorkspaceId>,
  workspaceRuntimeId: MaybeRefOrGetter<string>,
) {
  return useQuery(computed(() => repoWorktreeStatusQueryOptions(toValue(repoRoot), toValue(workspaceRuntimeId))))
}

interface RepoLogOptions {
  count?: MaybeRefOrGetter<number | undefined>
  skip?: MaybeRefOrGetter<number | undefined>
  enabled?: MaybeRefOrGetter<boolean | undefined>
}

export function useRepoLogQuery(
  repoRoot: MaybeRefOrGetter<WorkspaceId>,
  workspaceRuntimeId: MaybeRefOrGetter<string>,
  branch: MaybeRefOrGetter<string>,
  options: RepoLogOptions = {},
) {
  return useQuery(
    computed(() =>
      repoLogQueryOptions(toValue(repoRoot), toValue(workspaceRuntimeId), toValue(branch), {
        count: toValue(options.count),
        skip: toValue(options.skip),
        enabled: toValue(options.enabled),
      }),
    ),
  )
}

export function useRepoRemoteBranchesQuery(
  repoRoot: MaybeRefOrGetter<WorkspaceId>,
  workspaceRuntimeId: MaybeRefOrGetter<string>,
  options: { enabled?: MaybeRefOrGetter<boolean | undefined> } = {},
) {
  return useQuery(
    computed(() =>
      repoRemoteBranchesQueryOptions(toValue(repoRoot), toValue(workspaceRuntimeId), {
        enabled: toValue(options.enabled),
      }),
    ),
  )
}

export function useRepoOperationsReadModel(
  repoRoot: MaybeRefOrGetter<WorkspaceId>,
  workspaceRuntimeId: MaybeRefOrGetter<string>,
  options: {
    includeSettled?: MaybeRefOrGetter<boolean | undefined>
  } = {},
) {
  const query = useQuery(
    computed(() =>
      repoOperationsQueryOptions(toValue(repoRoot), toValue(workspaceRuntimeId), {
        includeSettled: toValue(options.includeSettled),
      }),
    ),
  )
  const data = computed(() => projectRepoOperationsQueryData({ status: query.status.value, data: query.data.value }))
  return { ...query, data }
}
