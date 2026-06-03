import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { JSONFilePreset } from 'lowdb/node'
import { serverDataFile } from '#/server/common/data-dir.ts'
import type { PullRequestFetchMode, PullRequestInfo } from '#/shared/git-types.ts'
import type { PullRequestEntry, RepoSnapshot } from '#/shared/rpc.ts'

interface RepoSnapshotRecord {
  value: RepoSnapshot
  updatedAt: number
}

interface PullRequestBranchRecord {
  value: PullRequestInfo | null
  updatedAt: number
}

interface PullRequestListRecord {
  entries: PullRequestEntry[]
  updatedAt: number
}

interface RepoReadModelData {
  snapshots: Record<string, RepoSnapshotRecord>
  pullRequests: Record<string, PullRequestBranchRecord>
  pullRequestLists: Record<string, PullRequestListRecord>
}

type RepoReadModelDb = Awaited<ReturnType<typeof openRepoReadModelDb>>

let dbPromise: Promise<RepoReadModelDb> | null = null

function pullRequestBranchKey(repoId: string, branch: string, mode: PullRequestFetchMode): string {
  return `${repoId}\0${mode}\0${branch}`
}

function pullRequestListKey(repoId: string, mode: PullRequestFetchMode): string {
  return `${repoId}\0${mode}`
}

async function openRepoReadModelDb() {
  const file = serverDataFile('repo-read-model.json')
  await mkdir(path.dirname(file), { recursive: true })
  return await JSONFilePreset<RepoReadModelData>(file, {
    snapshots: {},
    pullRequests: {},
    pullRequestLists: {},
  })
}

async function repoReadModelDb(): Promise<RepoReadModelDb> {
  dbPromise ??= openRepoReadModelDb()
  return await dbPromise
}

export async function readCachedRepoSnapshot(repoId: string): Promise<RepoSnapshot | null> {
  const db = await repoReadModelDb()
  return db.data.snapshots[repoId]?.value ?? null
}

export async function writeCachedRepoSnapshot(repoId: string, snapshot: RepoSnapshot): Promise<void> {
  const db = await repoReadModelDb()
  await db.update((data) => {
    data.snapshots[repoId] = {
      value: snapshot,
      updatedAt: Date.now(),
    }
  })
}

export async function readCachedPullRequests(
  repoId: string,
  branches: string[] | undefined,
  mode: PullRequestFetchMode,
): Promise<PullRequestEntry[] | undefined> {
  const db = await repoReadModelDb()
  if (branches === undefined) return db.data.pullRequestLists[pullRequestListKey(repoId, mode)]?.entries
  const entries: PullRequestEntry[] = []
  for (const branch of branches) {
    const record = db.data.pullRequests[pullRequestBranchKey(repoId, branch, mode)]
    if (!record) return undefined
    if (record.value) entries.push({ branch, pullRequest: record.value })
  }
  return entries
}

export async function writeCachedPullRequests(
  repoId: string,
  entries: PullRequestEntry[],
  options: { branches?: string[]; mode: PullRequestFetchMode },
): Promise<void> {
  const db = await repoReadModelDb()
  await db.update((data) => {
    const byBranch = new Map(entries.map((entry) => [entry.branch, entry.pullRequest]))
    if (options.branches === undefined) {
      data.pullRequestLists[pullRequestListKey(repoId, options.mode)] = {
        entries,
        updatedAt: Date.now(),
      }
      for (const [branch, pullRequest] of byBranch) {
        data.pullRequests[pullRequestBranchKey(repoId, branch, options.mode)] = {
          value: pullRequest,
          updatedAt: Date.now(),
        }
      }
      return
    }
    for (const branch of options.branches) {
      data.pullRequests[pullRequestBranchKey(repoId, branch, options.mode)] = {
        value: byBranch.get(branch) ?? null,
        updatedAt: Date.now(),
      }
    }
  })
}

export async function invalidateCachedRepoReadModel(
  repoId: string,
  options?: { snapshot?: boolean; pullRequests?: boolean },
): Promise<void> {
  const db = await repoReadModelDb()
  await db.update((data) => {
    if (options?.snapshot !== false) delete data.snapshots[repoId]
    if (options?.pullRequests !== false) {
      for (const key of Object.keys(data.pullRequests)) {
        if (key === repoId || key.startsWith(`${repoId}\0`)) delete data.pullRequests[key]
      }
      for (const key of Object.keys(data.pullRequestLists)) {
        if (key === repoId || key.startsWith(`${repoId}\0`)) delete data.pullRequestLists[key]
      }
    }
  })
}

export function resetRepoReadModelForTests(): void {
  dbPromise = null
}
