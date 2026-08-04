export interface RepoReadFailure {
  messageKey: string
  stale: boolean
  retrying: boolean
  retry?: () => void
}

interface RepoQueryReadFailureSource {
  isError: boolean
  error: unknown
  isFetching: boolean
  data: unknown
}

export function repoQueryReadFailure(source: RepoQueryReadFailureSource, retry?: () => void): RepoReadFailure | null {
  if (!source.isError) return null
  return {
    messageKey: source.error instanceof Error ? source.error.message : String(source.error || 'error.failed-read-repo'),
    stale: source.data !== undefined,
    retrying: source.isFetching,
    retry,
  }
}

export function repoReadFailures(...failures: Array<RepoReadFailure | null>): RepoReadFailure[] {
  return failures.filter((failure): failure is RepoReadFailure => failure !== null)
}
