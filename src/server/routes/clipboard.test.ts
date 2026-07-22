import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveClipboardFiles: vi.fn(),
  pruneStaleClipboardTempDirs: vi.fn(),
  pruneExpiredClipboardTempFiles: vi.fn(),
}))

vi.mock('#/server/modules/clipboard-write-paths.ts', () => ({
  saveClipboardFiles: mocks.saveClipboardFiles,
  pruneStaleClipboardTempDirs: mocks.pruneStaleClipboardTempDirs,
  pruneExpiredClipboardTempFiles: mocks.pruneExpiredClipboardTempFiles,
}))

describe('clipboard routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pruneStaleClipboardTempDirs.mockResolvedValue(undefined)
    mocks.pruneExpiredClipboardTempFiles.mockResolvedValue(undefined)
  })

  test('200 with absolute paths when the write module succeeds', async () => {
    mocks.saveClipboardFiles.mockResolvedValue({ paths: ['/tmp/a.png', '/tmp/b.bin'] })
    const { createClipboardRoutes } = await import('#/server/routes/clipboard.ts')
    const app = createClipboardRoutes()
    const form = new FormData()
    form.append('files', new File([new Uint8Array([1, 2, 3])], 'a.png'))
    form.append('files', new File([new Uint8Array([4, 5])], 'b.bin'))
    const res = await app.request(new Request('http://x/files', { method: 'POST', body: form }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paths: ['/tmp/a.png', '/tmp/b.bin'] })
    expect(mocks.saveClipboardFiles).toHaveBeenCalledWith(expect.any(Array))
  })

  test('200 when only one file is uploaded (Hono parseBody single-value path)', async () => {
    mocks.saveClipboardFiles.mockResolvedValue({ paths: ['/tmp/only.bin'] })
    const { createClipboardRoutes } = await import('#/server/routes/clipboard.ts')
    const app = createClipboardRoutes()
    const form = new FormData()
    form.append('files', new File([new Uint8Array([7])], 'only.bin'))
    const res = await app.request(new Request('http://x/files', { method: 'POST', body: form }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paths: ['/tmp/only.bin'] })
  })

  test('400 when the multipart body has no files field', async () => {
    const { createClipboardRoutes } = await import('#/server/routes/clipboard.ts')
    const app = createClipboardRoutes()
    const form = new FormData()
    form.append('other', 'value')
    const res = await app.request(new Request('http://x/files', { method: 'POST', body: form }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { ok: false; code: string; message: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('BAD_REQUEST')
    expect(mocks.saveClipboardFiles).not.toHaveBeenCalled()
  })

  test('400 when the files field arrives as a text value', async () => {
    const { createClipboardRoutes } = await import('#/server/routes/clipboard.ts')
    const app = createClipboardRoutes()
    const form = new FormData()
    form.append('files', 'not-a-file')
    const res = await app.request(new Request('http://x/files', { method: 'POST', body: form }))
    expect(res.status).toBe(400)
  })

  test('415 when the request is not multipart form data', async () => {
    const { createClipboardRoutes } = await import('#/server/routes/clipboard.ts')
    const app = createClipboardRoutes()
    const res = await app.request(
      new Request('http://x/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files: [] }),
      }),
    )
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Content-Type must be multipart/form-data',
    })
  })

  test('413 surfaces a PAYLOAD_TOO_LARGE envelope when the module throws "exceeds"', async () => {
    mocks.saveClipboardFiles.mockRejectedValue(new Error('Clipboard payload exceeds 12345 bytes'))
    const { createClipboardRoutes } = await import('#/server/routes/clipboard.ts')
    const app = createClipboardRoutes()
    const form = new FormData()
    form.append('files', new File([new Uint8Array([0])], 'a.png'))
    const res = await app.request(new Request('http://x/files', { method: 'POST', body: form }))
    expect(res.status).toBe(413)
    const body = (await res.json()) as { ok: false; code: string }
    expect(body.code).toBe('PAYLOAD_TOO_LARGE')
  })

  test('500 for unexpected module errors', async () => {
    mocks.saveClipboardFiles.mockRejectedValue(new Error('disk full'))
    const { createClipboardRoutes } = await import('#/server/routes/clipboard.ts')
    const app = createClipboardRoutes()
    const form = new FormData()
    form.append('files', new File([new Uint8Array([0])], 'a.png'))
    const res = await app.request(new Request('http://x/files', { method: 'POST', body: form }))
    expect(res.status).toBe(500)
  })

  test('triggers a one-shot prune at construction time', async () => {
    const { createClipboardRoutes } = await import('#/server/routes/clipboard.ts')
    createClipboardRoutes()
    // void pruneStaleClipboardTempDirs() returns synchronously; the mock
    // should have been called once.
    expect(mocks.pruneStaleClipboardTempDirs).toHaveBeenCalledTimes(1)
    expect(mocks.pruneExpiredClipboardTempFiles).toHaveBeenCalledTimes(1)
  })
})
