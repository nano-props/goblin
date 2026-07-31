export type IpcErrorCode = 'FORBIDDEN' | 'BAD_REQUEST' | 'NOT_FOUND' | 'INTERNAL_SERVER_ERROR'

/** Error type shared by the HTTP and native Electron bridge transport layers. */
export class IpcError extends Error {
  readonly code: string

  constructor(options: { code: IpcErrorCode | string; message: string }) {
    super(options.message)
    this.name = 'IpcError'
    this.code = options.code
  }
}
