export class RepositoryBoundaryUnavailableError extends Error {
  constructor() {
    super('error.repository-boundary-unavailable')
    this.name = 'RepositoryBoundaryUnavailableError'
  }
}

export function isRepositoryBoundaryUnavailableError(error: unknown): error is RepositoryBoundaryUnavailableError {
  return error instanceof RepositoryBoundaryUnavailableError
}
