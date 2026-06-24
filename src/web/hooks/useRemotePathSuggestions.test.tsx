// @vitest-environment jsdom

// Tests for the dedupe + filter behavior of useRemotePathSuggestions.
// The hook's contract with the server is:
//   • only fetch when `enabled`, an `alias`, and a resolvable
//     `prefix` are all present
//   • dedupe the server's response in-place — duplicates would collide
//     when used as React keys downstream — and drop non-string entries
//   • surface request lifecycle so the input can render a loading hint

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useRemotePathSuggestions } from '#/web/hooks/useRemotePathSuggestions.ts'

vi.mock('#/web/remote-client.ts', () => ({
  getRemotePathSuggestions: vi.fn(),
}))

import { getRemotePathSuggestions } from '#/web/remote-client.ts'

const mockedFetch = vi.mocked(getRemotePathSuggestions)

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  // Default no-op so the debounced fetch in the hook settles without
  // hitting the network. Per-test mocks override this.
  mockedFetch.mockResolvedValue([])
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  mockedFetch.mockReset()
})

describe('useRemotePathSuggestions', () => {
  test('dedupes duplicate paths while preserving server order', async () => {
    mockedFetch.mockResolvedValue(['/srv/a', '/srv/b', '/srv/a', '/srv/c', '/srv/b'])
    const result = await renderHookAndWaitForFetch({
      enabled: true,
      alias: 'host',
      remotePath: '/srv',
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
      remotePath: '/srv',
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
      remotePath: '/srv',
      prefix: '/srv/',
    })

    expect(result).toEqual({
      suggestions: [],
      isLoading: false,
      hasFetched: true,
    })
  })

  test('does not fetch when alias or prefix is missing', async () => {
    const emptyAlias = await renderHookAndWaitForFetch({
      enabled: true,
      alias: '',
      remotePath: '/srv',
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
      remotePath: '/srv',
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
    let resolveFetch: ((value: string[]) => void) | null = null
    mockedFetch.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const snapshots = await renderHookLifecycle({
      enabled: true,
      alias: 'host',
      remotePath: '/srv',
      prefix: '/srv/',
    })

    expect(snapshots.at(-1)).toEqual({
      suggestions: [],
      isLoading: true,
      hasFetched: false,
    })

    await act(async () => {
      resolveFetch?.(['/srv/a'])
      await Promise.resolve()
    })

    expect(snapshots.at(-1)).toEqual({
      suggestions: ['/srv/a'],
      isLoading: false,
      hasFetched: true,
    })
  })

  test('clears loading while a new query is waiting out debounce', async () => {
    vi.useFakeTimers()
    let resolveFetch: ((value: string[]) => void) | null = null
    mockedFetch.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveFetch = resolve
        }),
    )

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []

    function Host({ prefix }: { prefix: string }) {
      const state = useRemotePathSuggestions({
        enabled: true,
        alias: 'host',
        remotePath: '/srv',
        prefix,
      })
      snapshots.push(state)
      return null
    }

    try {
      await act(async () => {
        root!.render(<Host prefix="/srv/" />)
      })
      await act(async () => {
        vi.advanceTimersByTime(400)
        await Promise.resolve()
      })

      expect(snapshots.at(-1)).toEqual({
        suggestions: [],
        isLoading: true,
        hasFetched: false,
      })

      await act(async () => {
        root!.render(<Host prefix="/srv/r" />)
      })

      expect(snapshots.at(-1)).toEqual({
        suggestions: [],
        isLoading: false,
        hasFetched: false,
      })

      await act(async () => {
        vi.advanceTimersByTime(400)
        await Promise.resolve()
      })

      expect(snapshots.at(-1)).toEqual({
        suggestions: [],
        isLoading: true,
        hasFetched: false,
      })

      await act(async () => {
        resolveFetch?.(['/srv/result'])
        await Promise.resolve()
      })

      expect(snapshots.at(-1)).toEqual({
        suggestions: ['/srv/result'],
        isLoading: false,
        hasFetched: true,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

interface RenderInput {
  enabled: boolean
  alias: string
  remotePath: string
  prefix: string
}

async function renderHookAndWaitForFetch(input: RenderInput) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let captured = { suggestions: [] as string[], isLoading: false, hasFetched: false }
  function Host() {
    captured = useRemotePathSuggestions(input)
    return null
  }
  await act(async () => {
    root!.render(<Host />)
  })
  // The hook debounces by 350ms before firing; advance past that and
  // let the queued microtasks settle so the state update lands.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
  return captured
}

async function renderHookLifecycle(input: RenderInput) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []
  function Host() {
    const state = useRemotePathSuggestions(input)
    snapshots.push(state)
    return null
  }
  await act(async () => {
    root!.render(<Host />)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
  return snapshots
}
