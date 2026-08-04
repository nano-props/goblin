export interface RepoReadFailure {
  message: string
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
    message: source.error instanceof Error ? source.error.message : String(source.error || 'error.failed-read-repo'),
    stale: source.data !== undefined,
    retrying: source.isFetching,
    retry,
  }
}
