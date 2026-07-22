import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createHttpClipboardBackend } from '#/web/clipboard/http-backend.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

describe('createHttpClipboardBackend', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  test('returns [] without fetching when no files are given', async () => {
    const fetchMock = mockFetch()
    const backend = createHttpClipboardBackend({ url: 'http://server/', accessToken: 'sec' })
    expect(await backend.saveClipboardFiles([])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('posts multipart to /api/clipboard/files with the secret header', async () => {
    const fetchMock = mockFetch(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ paths: ['/tmp/a.png', '/tmp/b.png'] }),
    }))
    const backend = createHttpClipboardBackend({ url: 'http://server/', accessToken: 'sec-123' })
    const a = new File([new Uint8Array([1])], 'a.png')
    const b = new File([new Uint8Array([2])], 'b.png')
    const result = await backend.saveClipboardFiles([a, b])
    expect(result).toEqual(['/tmp/a.png', '/tmp/b.png'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    const url = call[0]
    const init = call[1]
    expect(String(url)).toBe('http://server/api/clipboard/files')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'x-goblin-access-token': 'sec-123' })
    expect(init?.body).toBeInstanceOf(FormData)
    const form = init?.body as FormData
    const filesField = form.getAll('files')
    expect(filesField).toHaveLength(2)
    expect((filesField[0] as File).name).toBe('a.png')
    expect((filesField[1] as File).name).toBe('b.png')
  })

  test('falls back to "clipboard.bin" when file.name is empty', async () => {
    const fetchMock = mockFetch(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ paths: ['/x'] }),
    }))
    const backend = createHttpClipboardBackend({ url: 'http://server/', accessToken: 'sec' })
    const blob = new File([new Uint8Array([1])], '')
    await backend.saveClipboardFiles([blob])
    const init = fetchMock.mock.calls[0][1]
    const form = init?.body as FormData
    const filesField = form.get('files') as File
    expect(filesField.name).toBe('clipboard.bin')
  })

  test('rejects when fetch resolves with !ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    )
    const backend = createHttpClipboardBackend({ url: 'http://server/', accessToken: 'sec' })
    await expect(backend.saveClipboardFiles([new File([new Uint8Array([1])], 'a')])).rejects.toThrow(
      'Clipboard file request failed with status 401',
    )
  })

  test('rejects when fetch rejects (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network')
      }),
    )
    const backend = createHttpClipboardBackend({ url: 'http://server/', accessToken: 'sec' })
    await expect(backend.saveClipboardFiles([new File([new Uint8Array([1])], 'a')])).rejects.toThrow('network')
  })

  test('rejects when response paths is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ paths: 'not-an-array' }) })),
    )
    const backend = createHttpClipboardBackend({ url: 'http://server/', accessToken: 'sec' })
    await expect(backend.saveClipboardFiles([new File([new Uint8Array([1])], 'a')])).rejects.toThrow(
      'Invalid clipboard file response',
    )
  })

  test('rejects the complete response when any path entry is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ paths: ['/ok', 123, null, '/also-ok'] }) })),
    )
    const backend = createHttpClipboardBackend({ url: 'http://server/', accessToken: 'sec' })
    await expect(backend.saveClipboardFiles([new File([new Uint8Array([1])], 'a')])).rejects.toThrow(
      'Invalid clipboard file response',
    )
  })
})
