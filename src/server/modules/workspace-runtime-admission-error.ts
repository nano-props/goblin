export class WorkspaceRuntimeAdmissionClosedError extends Error {
  constructor() {
    super('error.workspace-runtime-stale')
    this.name = 'WorkspaceRuntimeAdmissionClosedError'
  }
}

export function isWorkspaceRuntimeAdmissionClosedError(
  error: unknown,
): error is WorkspaceRuntimeAdmissionClosedError {
  return error instanceof WorkspaceRuntimeAdmissionClosedError
}
