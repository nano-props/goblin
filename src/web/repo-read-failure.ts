export interface RepoReadFailure {
  messageKey: string
  stale: boolean
  retrying: boolean
  retry?: () => void
}

interface RepoReadFailureSource {
  isError: boolean
  error: unknown
  isFetching: boolean
}

export function repoReadFailure(
  source: RepoReadFailureSource,
  stale: boolean,
  retry?: () => void,
): RepoReadFailure | null {
  if (!source.isError) return null
  return {
    messageKey: source.error instanceof Error ? source.error.message : String(source.error || 'error.failed-read-repo'),
    stale,
    retrying: source.isFetching,
    retry,
  }
}

export function repoReadFailures(...failures: Array<RepoReadFailure | null>): RepoReadFailure[] {
  return failures.filter((failure): failure is RepoReadFailure => failure !== null)
}
