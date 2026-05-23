import PQueue from 'p-queue'

export const GITHUB_API_CONCURRENCY = 3
export const GITHUB_API_INTERVAL_CAP = 10
export const GITHUB_API_INTERVAL_MS = 1_000

export interface GitHubApiQueueOptions {
  concurrency?: number
  intervalCap?: number
  interval?: number
}

export function createGitHubApiQueue(options: GitHubApiQueueOptions = {}): PQueue {
  return new PQueue({
    concurrency: options.concurrency ?? GITHUB_API_CONCURRENCY,
    interval: options.interval ?? GITHUB_API_INTERVAL_MS,
    intervalCap: options.intervalCap ?? GITHUB_API_INTERVAL_CAP,
    strict: true,
  })
}

const githubApiQueue = createGitHubApiQueue()

export function enqueueGitHubApiRequest<T>(task: () => Promise<T>): Promise<T> {
  return githubApiQueue.add(task)
}
