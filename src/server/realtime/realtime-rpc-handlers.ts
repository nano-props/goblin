import type { RealtimeRpcAction } from '#/shared/realtime-rpc.ts'

type MaybePromise<T> = T | Promise<T>

export type RealtimeRpcHandlers<TInputs extends object, TOutputs extends object> = {
  [Action in RealtimeRpcAction<TInputs, TOutputs>]: (
    clientId: string,
    userId: string,
    input: TInputs[Action],
  ) => MaybePromise<TOutputs[Action]>
}

export async function invokeRealtimeRpcHandler<
  TInputs extends object,
  TOutputs extends object,
  TAction extends RealtimeRpcAction<TInputs, TOutputs>,
>(
  handlers: RealtimeRpcHandlers<TInputs, TOutputs>,
  clientId: string,
  userId: string,
  action: TAction,
  input: TInputs[TAction],
): Promise<TOutputs[TAction]> {
  return await handlers[action](clientId, userId, input)
}
