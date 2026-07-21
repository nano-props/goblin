export type RealtimeRpcAction<TInputs extends object, TOutputs extends object> = keyof TInputs & keyof TOutputs & string

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

export type RealtimeRpcResponseMessage<
  TInputs extends object,
  TOutputs extends object,
  TAction extends RealtimeRpcAction<TInputs, TOutputs> = RealtimeRpcAction<TInputs, TOutputs>,
> = {
  [Action in TAction]:
    | {
        type: 'response'
        requestId: string
        ok: true
        action: Action
        payload: TOutputs[Action]
      }
    | {
        type: 'response'
        requestId: string
        ok: false
        action: Action
        error: string
      }
}[TAction]
