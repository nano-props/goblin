// @vitest-environment jsdom

// Tests for the current-query lifecycle shared by local and SSH suggestions.
// The hook's contract with the server is:
//   • fetch only eligible native local prefixes or resolvable SSH prefixes
//   • dedupe the server's response in-place — duplicates would collide
//     when used as vnode keys downstream — and drop non-string entries
//   • surface request lifecycle so the input can render a loading hint

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import { useDirectoryPathSuggestions } from '#/web/hooks/useDirectoryPathSuggestions.ts'

vi.mock('#/web/remote-workspace-client.ts', () => ({
  getRemotePathSuggestions: vi.fn(),
}))
vi.mock('#/web/workspace-client.ts', () => ({
  getLocalDirectoryPathSuggestions: vi.fn(),
}))
vi.mock('#/web/stores/host-info.ts', () => ({
  getPlatform: () => 'linux',
}))

import { getRemotePathSuggestions } from '#/web/remote-workspace-client.ts'
import { getLocalDirectoryPathSuggestions } from '#/web/workspace-client.ts'

const mockedFetch = vi.mocked(getRemotePathSuggestions)
const mockedLocalFetch = vi.mocked(getLocalDirectoryPathSuggestions)

beforeEach(() => {
  // Default no-op so the debounced fetch in the hook settles without
  // hitting the network. Per-test mocks override this.
  mockedFetch.mockResolvedValue([])
  mockedLocalFetch.mockResolvedValue([])
})

afterEach(() => {
  mockedFetch.mockReset()
  mockedLocalFetch.mockReset()
})

describe('useDirectoryPathSuggestions', () => {
  test('dedupes duplicate paths while preserving server order', async () => {
    mockedFetch.mockResolvedValue(['/srv/a', '/srv/b', '/srv/a', '/srv/c', '/srv/b'])
    const result = await renderHookAndWaitForFetch({
      enabled: true,
      alias: 'host',
      prefix: '/srv/',
    })

    expect(result).toEqual({
      suggestions: ['/srv/a', '/srv/b', '/srv/c'],
      isLoading: false,
      hasFetched: true,
    })
  })

  test('drops non-string entries from the response', async () => {
    // The runtime filter is defensive — the server's contract is
    // `string[]`, but a misbehaving server should not crash the UI.
    mockedFetch.mockResolvedValue(['/srv/a', 42 as unknown as string, '/srv/b', null as unknown as string])
    const result = await renderHookAndWaitForFetch({
      enabled: true,
      alias: 'host',
      prefix: '/srv/',
    })

    expect(result).toEqual({
      suggestions: ['/srv/a', '/srv/b'],
      isLoading: false,
      hasFetched: true,
    })
  })

  test('returns an empty list when the server response is not an array', async () => {
    mockedFetch.mockResolvedValue(undefined as unknown as string[])
    const result = await renderHookAndWaitForFetch({
      enabled: true,
      alias: 'host',
      prefix: '/srv/',
    })

    expect(result).toEqual({
      suggestions: [],
      isLoading: false,
      hasFetched: false,
    })
  })

  test('does not fetch when alias or prefix is missing', async () => {
    const emptyAlias = await renderHookAndWaitForFetch({
      enabled: true,
      alias: '',
      prefix: '/srv/',
    })
    expect(emptyAlias).toEqual({
      suggestions: [],
      isLoading: false,
      hasFetched: false,
    })
    expect(mockedFetch).not.toHaveBeenCalled()

    const emptyPrefix = await renderHookAndWaitForFetch({
      enabled: true,
      alias: 'host',
      prefix: '',
    })
    expect(emptyPrefix).toEqual({
      suggestions: [],
      isLoading: false,
      hasFetched: false,
    })
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  test('reports loading once the debounced request has started', async () => {
    const fetch = Promise.withResolvers<string[]>()
    mockedFetch.mockReturnValue(fetch.promise)

    const snapshots = await renderHookLifecycle({
      enabled: true,
      alias: 'host',
      prefix: '/srv/',
    })

    expect(snapshots.at(-1)).toEqual({
      suggestions: [],
      isLoading: true,
      hasFetched: false,
    })

    await flushTestUpdates(async () => {
      fetch.resolve(['/srv/a'])
      await fetch.promise
    })

    expect(snapshots.at(-1)).toEqual({
      suggestions: ['/srv/a'],
      isLoading: false,
      hasFetched: true,
    })
  })

  test('clears loading while a new query is waiting out debounce', async () => {
    useFakeTimers()
    const firstFetch = Promise.withResolvers<string[]>()
    const secondFetch = Promise.withResolvers<string[]>()
    mockedFetch.mockReturnValueOnce(firstFetch.promise).mockReturnValueOnce(secondFetch.promise)

    const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []

    const Host = defineComponent<{ prefix: string }>({
      name: 'RemotePathSuggestionsTestHost',
      props: ['prefix'],
      setup(props) {
        const state = useDirectoryPathSuggestions({
          enabled: true,
          source: { kind: 'ssh', alias: 'host' },
          prefix: () => props.prefix,
        })
        snapshots.push(state)
        return () => null
      },
    })

    const { rerender } = renderInJsdom(<Host prefix="/srv/" />)

    await flushTestUpdates(async () => await advanceTimersAndFlush(400))

    expect(snapshots.at(-1)).toEqual({
      suggestions: [],
      isLoading: true,
      hasFetched: false,
    })

    await rerender(<Host prefix="/srv/r" />)

    expect(snapshots.at(-1)).toEqual({
      suggestions: [],
      isLoading: false,
      hasFetched: false,
    })

    await flushTestUpdates(async () => await advanceTimersAndFlush(400))

    expect(snapshots.at(-1)).toEqual({
      suggestions: [],
      isLoading: true,
      hasFetched: false,
    })

    await flushTestUpdates(async () => {
      secondFetch.resolve(['/srv/result'])
      await secondFetch.promise
    })

    expect(snapshots.at(-1)).toEqual({
      suggestions: ['/srv/result'],
      isLoading: false,
      hasFetched: true,
    })
  })

  test('uses the local source and hides stale rows synchronously when identity changes', async () => {
    useFakeTimers()
    mockedLocalFetch.mockResolvedValueOnce(['/srv/alpha']).mockResolvedValueOnce(['/srv/beta'])
    const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []

    const Host = defineComponent<{ prefix: string }>({
      name: 'LocalPathSuggestionsTestHost',
      props: ['prefix'],
      setup(props) {
        const state = useDirectoryPathSuggestions({
          enabled: true,
          source: { kind: 'local' },
          prefix: () => props.prefix,
        })
        snapshots.push(state)
        return () => null
      },
    })

    const { rerender } = renderInJsdom(<Host prefix="/srv/a" />)
    await flushTestUpdates(async () => await advanceTimersAndFlush(350))
    expect(snapshots.at(-1)?.suggestions).toEqual(['/srv/alpha'])
    expect(mockedLocalFetch).toHaveBeenCalledWith('/srv/a', expect.any(AbortSignal))

    await rerender(<Host prefix="/srv/b" />)
    expect(snapshots.at(-1)).toEqual({ suggestions: [], isLoading: false, hasFetched: false })

    await flushTestUpdates(async () => await advanceTimersAndFlush(350))
    expect(snapshots.at(-1)?.suggestions).toEqual(['/srv/beta'])
  })

  test('aborts an alias query and ignores its late completion after identity changes', async () => {
    useFakeTimers()
    const first = Promise.withResolvers<string[]>()
    const second = Promise.withResolvers<string[]>()
    mockedFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []

    const Host = defineComponent<{ alias: string }>({
      name: 'AliasedPathSuggestionsTestHost',
      props: ['alias'],
      setup(props) {
        const state = useDirectoryPathSuggestions({
          enabled: true,
          source: () => ({ kind: 'ssh', alias: props.alias }),
          prefix: '/srv/',
        })
        snapshots.push(state)
        return () => null
      },
    })

    const { rerender } = renderInJsdom(<Host alias="first" />)
    await flushTestUpdates(async () => await advanceTimersAndFlush(350))
    const firstSignal = mockedFetch.mock.calls[0]?.[1]
    expect(firstSignal?.aborted).toBe(false)

    await rerender(<Host alias="second" />)
    expect(firstSignal?.aborted).toBe(true)
    expect(snapshots.at(-1)).toEqual({ suggestions: [], isLoading: false, hasFetched: false })
    await flushTestUpdates(async () => await advanceTimersAndFlush(350))

    await flushTestUpdates(async () => {
      second.resolve(['/srv/current'])
      await second.promise
    })
    expect(snapshots.at(-1)?.suggestions).toEqual(['/srv/current'])

    await flushTestUpdates(async () => {
      first.resolve(['/srv/stale'])
      await first.promise
    })
    expect(snapshots.at(-1)?.suggestions).toEqual(['/srv/current'])
  })

  test('keeps one request for raw inputs with the same canonical identity', async () => {
    useFakeTimers()
    const request = Promise.withResolvers<string[]>()
    mockedFetch.mockReturnValue(request.promise)
    const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []
    const Host = defineComponent<{ alias: string; prefix: string }>({
      name: 'CanonicalPathSuggestionsTestHost',
      props: ['alias', 'prefix'],
      setup(props) {
        const state = useDirectoryPathSuggestions({
          enabled: true,
          source: () => ({ kind: 'ssh', alias: props.alias }),
          prefix: () => props.prefix,
        })
        snapshots.push(state)
        return () => null
      },
    })
    const view = renderInJsdom(<Host alias="prod" prefix="/srv/repo" />)
    await flushTestUpdates(async () => await advanceTimersAndFlush(350))
    const signal = mockedFetch.mock.calls[0]?.[1]

    await view.rerender(<Host alias=" prod " prefix=" /srv/repo " />)
    await flushTestUpdates(async () => await advanceTimersAndFlush(350))

    expect(mockedFetch).toHaveBeenCalledOnce()
    expect(signal?.aborted).toBe(false)
    await flushTestUpdates(async () => {
      request.resolve(['/srv/repo'])
      await request.promise
    })
    expect(snapshots.at(-1)?.suggestions).toEqual(['/srv/repo'])
  })

  test('distinguishes a successful empty result from a rejected request', async () => {
    mockedFetch.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline'))
    expect(await renderHookAndWaitForFetch({ enabled: true, alias: 'host', prefix: '/empty/' })).toEqual({
      suggestions: [],
      isLoading: false,
      hasFetched: true,
    })
    expect(await renderHookAndWaitForFetch({ enabled: true, alias: 'host', prefix: '/failed/' })).toEqual({
      suggestions: [],
      isLoading: false,
      hasFetched: false,
    })
  })
})

interface RenderInput {
  enabled: boolean
  alias: string
  prefix: string
}

async function renderHookAndWaitForFetch(input: RenderInput) {
  useFakeTimers()
  let captured = { suggestions: [] as string[], isLoading: false, hasFetched: false }
  const Host = defineComponent({
    name: 'PathSuggestionsResultTestHost',
    setup() {
      captured = useDirectoryPathSuggestions({
        enabled: input.enabled,
        source: { kind: 'ssh', alias: input.alias },
        prefix: input.prefix,
      })
      return () => null
    },
  })
  renderInJsdom(<Host />)
  // The hook debounces by 350ms before firing; advance past that and
  // let the queued microtasks settle so the state update lands.
  await flushTestUpdates(async () => await advanceTimersAndFlush(350))
  return captured
}

async function renderHookLifecycle(input: RenderInput) {
  useFakeTimers()
  const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []
  const Host = defineComponent({
    name: 'PathSuggestionsLifecycleTestHost',
    setup() {
      const state = useDirectoryPathSuggestions({
        enabled: input.enabled,
        source: { kind: 'ssh', alias: input.alias },
        prefix: input.prefix,
      })
      snapshots.push(state)
      return () => null
    },
  })
  renderInJsdom(<Host />)
  await flushTestUpdates(async () => await advanceTimersAndFlush(350))
  return snapshots
}
