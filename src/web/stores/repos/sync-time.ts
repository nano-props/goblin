// Single source of truth for "when was this repo's view last refreshed?".
// Lives next to the repos store rather than inside any one component so
// sibling consumers (the picker host, the refresh tooltip) can share it
// without importing each other.
import type { RepoState } from '#/web/stores/repos/types.ts'

export function latestRepoSyncTime(repo: Pick<RepoState, 'projection' | 'dataLoads'>): number | null {
  const snapshotLoadedAt = repo.projection.source === 'fresh' ? repo.dataLoads.snapshot.loadedAt : null
  const times = [repo.dataLoads.fetch.loadedAt, snapshotLoadedAt].filter((time): time is number => time !== null)
  return times.length === 0 ? null : Math.max(...times)
}
