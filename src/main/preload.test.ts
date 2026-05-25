import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, test, vi } from 'vitest'

function loadPreload(options: { invoke?: (channel: string, ...args: unknown[]) => Promise<unknown> } = {}) {
  const exposed: Record<string, any> = {}
  const invocations: Array<{ channel: string; args: unknown[] }> = []
  const code = readFileSync(path.join(import.meta.dirname, '../preload/preload.cjs'), 'utf8')
  const sandbox = {
    console,
    process: { argv: [] },
    require: (name: string) => {
      if (name !== 'electron') throw new Error(`unexpected require: ${name}`)
      return {
        contextBridge: {
          exposeInMainWorld: (key: string, api: unknown) => {
            exposed[key] = api
          },
        },
        ipcRenderer: {
          invoke: vi.fn((channel: string, ...args: unknown[]) => {
            invocations.push({ channel, args })
            return options.invoke?.(channel, ...args) ?? Promise.resolve({ ok: true, data: 'ok' })
          }),
          on: vi.fn(),
          off: vi.fn(),
        },
        webUtils: { getPathForFile: vi.fn() },
      }
    },
  }
  vm.runInNewContext(code, sandbox, { filename: 'preload.cjs' })
  return { goblin: exposed.goblin, invocations }
}

describe('preload goblin bridge', () => {
  test('forwards RPC request ids to the main process', async () => {
    const { goblin, invocations } = loadPreload()

    await goblin.invokeRpc({ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'rpc_test_1' })

    expect(invocations[0]).toEqual({
      channel: 'goblin:rpc',
      args: [{ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'rpc_test_1' }],
    })
  })

  test('uses a transport control channel for RPC aborts', async () => {
    const { goblin, invocations } = loadPreload()

    await goblin.abortRpc('rpc_test_1')

    expect(invocations[0]).toEqual({
      channel: 'goblin:rpc-abort',
      args: [{ requestId: 'rpc_test_1' }],
    })
  })

  test('logs failed RPC calls with the request path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { goblin } = loadPreload({
      invoke: () => Promise.resolve({ ok: false, error: { message: 'boom' } }),
    })

    await expect(
      goblin.invokeRpc({ path: 'repo.status', input: { cwd: '/repo' }, requestId: 'rpc_test_1' }),
    ).rejects.toThrow('boom')

    expect(warn.mock.calls[0]?.[0]).toBe('[rpc] repo.status failed')
    expect((warn.mock.calls[0]?.[1] as Error | undefined)?.message).toBe('boom')
    warn.mockRestore()
  })
})
