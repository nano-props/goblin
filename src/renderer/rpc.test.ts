import { describe, expect, test } from 'vitest'
import { rpc } from '#/renderer/rpc.ts'

const abortablePaths = [
  'repo.fetch',
  'repo.pull',
  'repo.push',
  'repo.checkout',
  'repo.createWorktree',
  'repo.deleteBranch',
  'repo.removeWorktree',
] as const

type AbortablePath = (typeof abortablePaths)[number]

function installBridge(calls: Array<{ path: string; input?: unknown }>, result = new Promise(() => {})): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      goblin: {
        homeDir: '/Users/test',
        invokeRpc: ({ path, input }: { path: string; input?: unknown }) => {
          calls.push({ path, input })
          return path === 'repo.abort' ? Promise.resolve(false) : result
        },
        onEvent: () => () => {},
        pathForFile: () => '',
      },
    },
  })
}

function mutateAbortable(path: AbortablePath, signal: AbortSignal): Promise<unknown> {
  const input = { cwd: '/tmp/repo' } as never
  switch (path) {
    case 'repo.fetch':
      return rpc.repo.fetch.mutate(input, { signal })
    case 'repo.pull':
      return rpc.repo.pull.mutate(input, { signal })
    case 'repo.push':
      return rpc.repo.push.mutate(input, { signal })
    case 'repo.checkout':
      return rpc.repo.checkout.mutate(input, { signal })
    case 'repo.createWorktree':
      return rpc.repo.createWorktree.mutate(input, { signal })
    case 'repo.deleteBranch':
      return rpc.repo.deleteBranch.mutate(input, { signal })
    case 'repo.removeWorktree':
      return rpc.repo.removeWorktree.mutate(input, { signal })
  }
}

describe('renderer rpc abort forwarding', () => {
  test.each(abortablePaths)('forwards abort for %s', async (path) => {
    const calls: Array<{ path: string; input?: unknown }> = []
    installBridge(calls)
    const ctrl = new AbortController()
    const promise = mutateAbortable(path, ctrl.signal)

    ctrl.abort()
    await expect(promise).rejects.toThrow('Request aborted')

    expect(calls).toContainEqual({ path: 'repo.abort', input: { cwd: '/tmp/repo' } })
  })
})
