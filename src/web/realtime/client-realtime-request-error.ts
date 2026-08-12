export type ClientRealtimeRequestFailureKind =
  | 'unavailable'
  | 'open-timeout'
  | 'open-failed'
  | 'send-failed'
  | 'disconnected'
  | 'timeout'
  | 'invalid-response'
  | 'app-quitting'

export class ClientRealtimeRequestError extends Error {
  readonly kind: ClientRealtimeRequestFailureKind
  readonly delivery: 'not-sent' | 'indeterminate'
  readonly outageId: number | null

  constructor(
    message: string,
    options: {
      kind: ClientRealtimeRequestFailureKind
      delivery: 'not-sent' | 'indeterminate'
      outageId: number | null
    },
  ) {
    super(message)
    this.name = 'ClientRealtimeRequestError'
    this.kind = options.kind
    this.delivery = options.delivery
    this.outageId = options.outageId
  }
}
