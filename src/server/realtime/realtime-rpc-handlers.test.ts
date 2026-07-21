import { expect, test } from 'vitest'
import { invokeRealtimeRpcHandler, type RealtimeRpcHandlers } from '#/server/realtime/realtime-rpc-handlers.ts'

interface TestInputs {
  read: { id: string }
}

interface TestOutputs {
  read: { name: string }
}

// @ts-expect-error Every request action must declare a response output.
type MissingOutputHandlers = RealtimeRpcHandlers<TestInputs, {}>

test('preserves the action input/output relationship during dispatch', async () => {
  const handlers: RealtimeRpcHandlers<TestInputs, TestOutputs> = {
    read: (_clientId, _userId, input) => ({ name: input.id }),
  }

  await expect(invokeRealtimeRpcHandler(handlers, 'client', 'user', 'read', { id: 'repo' })).resolves.toEqual({
    name: 'repo',
  })
})
