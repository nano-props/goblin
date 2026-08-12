export type RealtimeRpcOutputs<TInputs extends object> = { [Action in keyof TInputs]: unknown }

export type RealtimeRpcAction<TInputs extends object> = keyof TInputs & string

export type RealtimeRpcRequestMessage<
  TInputs extends object,
  TAction extends keyof TInputs & string = keyof TInputs & string,
> = {
  [Action in TAction]: {
    type: 'request'
    requestId: string
    action: Action
    input: TInputs[Action]
  }
}[TAction]

export type RealtimeRpcResponseEnvelope<TAction extends string, TOutput = unknown> =
  | {
      type: 'response'
      requestId: string
      ok: true
      action: TAction
      payload: TOutput
    }
  | {
      type: 'response'
      requestId: string
      ok: false
      action: TAction
      error: string
      outcome?: 'indeterminate'
    }

export type RealtimeRpcResponseMessage<
  TInputs extends object,
  TOutputs extends RealtimeRpcOutputs<TInputs>,
  TAction extends RealtimeRpcAction<TInputs> = RealtimeRpcAction<TInputs>,
> = {
  [Action in TAction]: RealtimeRpcResponseEnvelope<Action, TOutputs[Action]>
}[TAction]
