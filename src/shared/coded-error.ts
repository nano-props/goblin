export type CodedErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_SERVER_ERROR'
  | 'OUTCOME_UNCERTAIN'

/** Error with a stable machine-readable code that survives HTTP and native IPC boundaries. */
export class CodedError extends Error {
  readonly code: CodedErrorCode

  constructor(options: { code: CodedErrorCode; message: string; cause?: unknown }) {
    super(options.message, { cause: options.cause })
    this.name = 'CodedError'
    this.code = options.code
  }
}
