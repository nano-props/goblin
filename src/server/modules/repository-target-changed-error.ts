export class RepositoryTargetChangedError extends Error {
  constructor() {
    super('error.repository-target-changed')
    this.name = 'RepositoryTargetChangedError'
  }
}

export function isRepositoryTargetChangedError(error: unknown): error is RepositoryTargetChangedError {
  return error instanceof RepositoryTargetChangedError
}
