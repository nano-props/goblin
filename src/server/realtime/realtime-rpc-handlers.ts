import type { RealtimeRpcAction, RealtimeRpcOutputs } from '#/shared/realtime-rpc.ts'

type MaybePromise<T> = T | Promise<T>

export type RealtimeRpcHandlers<TInputs extends object, TOutputs extends RealtimeRpcOutputs<TInputs>> = {
  [Action in RealtimeRpcAction<TInputs>]: (
    clientId: string,
    userId: string,
    input: TInputs[Action],
  ) => MaybePromise<TOutputs[Action]>
}

export async function invokeRealtimeRpcHandler<
  TInputs extends object,
  TOutputs extends RealtimeRpcOutputs<TInputs>,
  TAction extends RealtimeRpcAction<TInputs>,
>(
  handlers: RealtimeRpcHandlers<TInputs, TOutputs>,
  clientId: string,
  userId: string,
  action: TAction,
  input: TInputs[TAction],
): Promise<TOutputs[TAction]> {
  return await handlers[action](clientId, userId, input)
}
