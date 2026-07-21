// @vitest-environment jsdom

// Tests for the current-query lifecycle shared by local and SSH suggestions.
// The hook's contract with the server is:
//   • only fetch when `enabled`, an `alias`, and a resolvable
//     `prefix` are all present
//   • dedupe the server's response in-place — duplicates would collide
//     when used as React keys downstream — and drop non-string entries
//   • surface request lifecycle so the input can render a loading hint

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
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

    const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []

    function Host({ prefix }: { prefix: string }) {
      const state = useDirectoryPathSuggestions({
        enabled: true,
        source: { kind: 'ssh', alias: 'host' },
        prefix,
      })
      snapshots.push(state)
      return null
    }

    const { rerender } = renderInJsdom(<Host prefix="/srv/" />)

    try {
      await act(async () => {
        vi.advanceTimersByTime(400)
        await Promise.resolve()
      })

      expect(snapshots.at(-1)).toEqual({
        suggestions: [],
        isLoading: true,
        hasFetched: false,
      })

      rerender(<Host prefix="/srv/r" />)

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

  test('uses the local source and hides stale rows synchronously when identity changes', async () => {
    vi.useFakeTimers()
    mockedLocalFetch.mockResolvedValueOnce(['/srv/alpha']).mockResolvedValueOnce(['/srv/beta'])
    const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []

    function Host({ prefix }: { prefix: string }) {
      const state = useDirectoryPathSuggestions({ enabled: true, source: { kind: 'local' }, prefix })
      snapshots.push(state)
      return null
    }

    const { rerender } = renderInJsdom(<Host prefix="/srv/a" />)
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })
      expect(snapshots.at(-1)?.suggestions).toEqual(['/srv/alpha'])
      expect(mockedLocalFetch).toHaveBeenCalledWith('/srv/a', expect.any(AbortSignal))

      rerender(<Host prefix="/srv/b" />)
      expect(snapshots.at(-1)).toEqual({ suggestions: [], isLoading: false, hasFetched: false })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })
      expect(snapshots.at(-1)?.suggestions).toEqual(['/srv/beta'])
    } finally {
      vi.useRealTimers()
    }
  })
})

interface RenderInput {
  enabled: boolean
  alias: string
  prefix: string
}

async function renderHookAndWaitForFetch(input: RenderInput) {
  let captured = { suggestions: [] as string[], isLoading: false, hasFetched: false }
  function Host() {
    captured = useDirectoryPathSuggestions({
      enabled: input.enabled,
      source: { kind: 'ssh', alias: input.alias },
      prefix: input.prefix,
    })
    return null
  }
  renderInJsdom(<Host />)
  // The hook debounces by 350ms before firing; advance past that and
  // let the queued microtasks settle so the state update lands.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
  return captured
}

async function renderHookLifecycle(input: RenderInput) {
  const snapshots: Array<{ suggestions: string[]; isLoading: boolean; hasFetched: boolean }> = []
  function Host() {
    const state = useDirectoryPathSuggestions({
      enabled: input.enabled,
      source: { kind: 'ssh', alias: input.alias },
      prefix: input.prefix,
    })
    snapshots.push(state)
    return null
  }
  renderInJsdom(<Host />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400))
  })
  return snapshots
}
