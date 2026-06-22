import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'

const mocks = vi.hoisted(() => ({
  resolvePastedFiles: vi.fn(),
}))

vi.mock('#/web/clipboard/resolver.ts', () => ({
  resolvePastedFiles: mocks.resolvePastedFiles,
}))

describe('processPaste', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns no-op for empty input', async () => {
    const { processPaste } = await import('#/web/clipboard/process.ts')
    await expect(processPaste({ files: [] })).resolves.toEqual({ kind: 'no-op' })
    expect(mocks.resolvePastedFiles).not.toHaveBeenCalled()
  })

  test('returns too-large for any file exceeding PASTE_FILE_MAX_BYTES', async () => {
    const { processPaste } = await import('#/web/clipboard/process.ts')
    const ok = new File([new Uint8Array([1])], 'ok.png')
    const huge = new File([new Uint8Array(PASTE_FILE_MAX_BYTES + 1)], 'huge.bin')
    await expect(processPaste({ files: [ok, huge] })).resolves.toEqual({ kind: 'too-large' })
    expect(mocks.resolvePastedFiles).not.toHaveBeenCalled()
  })

  test('returns the resolver result on the happy path', async () => {
    mocks.resolvePastedFiles.mockResolvedValue({ paths: ['/abs/foo.png'], failedUnsafe: 0, failedBackend: 0 })
    const { processPaste } = await import('#/web/clipboard/process.ts')
    const f = new File([new Uint8Array([1])], 'foo.png')
    await expect(processPaste({ files: [f] })).resolves.toEqual({
      kind: 'files',
      resolution: { paths: ['/abs/foo.png'], failedUnsafe: 0, failedBackend: 0 },
    })
  })

  test('passes partial failure through from the resolver', async () => {
    mocks.resolvePastedFiles.mockResolvedValue({ paths: ['/tmp/a'], failedUnsafe: 0, failedBackend: 1 })
    const { processPaste } = await import('#/web/clipboard/process.ts')
    const a = new File([new Uint8Array([1])], 'a')
    const b = new File([new Uint8Array([1])], 'b')
    await expect(processPaste({ files: [a, b] })).resolves.toEqual({
      kind: 'files',
      resolution: { paths: ['/tmp/a'], failedUnsafe: 0, failedBackend: 1 },
    })
  })
})

describe('processDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns no-op for empty input', async () => {
    const { processDrop } = await import('#/web/clipboard/process.ts')
    await expect(processDrop({ files: [] })).resolves.toEqual({ kind: 'no-op' })
  })

  test('returns too-large for any file over the cap', async () => {
    const { processDrop } = await import('#/web/clipboard/process.ts')
    const huge = new File([new Uint8Array(PASTE_FILE_MAX_BYTES + 1)], 'huge.bin')
    await expect(processDrop({ files: [huge] })).resolves.toEqual({ kind: 'too-large' })
    expect(mocks.resolvePastedFiles).not.toHaveBeenCalled()
  })

  test('delegates to the resolver for OK-sized files', async () => {
    mocks.resolvePastedFiles.mockResolvedValue({ paths: ['/abs/a'], failedUnsafe: 0, failedBackend: 0 })
    const { processDrop } = await import('#/web/clipboard/process.ts')
    const a = new File([new Uint8Array([1])], 'a')
    await expect(processDrop({ files: [a] })).resolves.toEqual({
      kind: 'files',
      resolution: { paths: ['/abs/a'], failedUnsafe: 0, failedBackend: 0 },
    })
  })
})
