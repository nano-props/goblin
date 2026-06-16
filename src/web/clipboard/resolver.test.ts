import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pathForDroppedFile: vi.fn<(file: File) => string>(),
  saveClipboardFiles: vi.fn<(files: File[]) => Promise<string[]>>(),
}))

vi.mock('#/web/app-shell-client.ts', () => ({
  pathForDroppedFile: mocks.pathForDroppedFile,
  saveClipboardFiles: mocks.saveClipboardFiles,
}))

describe('resolvePastedFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pathForDroppedFile.mockReturnValue('')
    mocks.saveClipboardFiles.mockResolvedValue([])
  })

  test('returns {paths: [], failed: 0} for empty input', async () => {
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    await expect(resolvePastedFiles([])).resolves.toEqual({ paths: [], failed: 0 })
    expect(mocks.saveClipboardFiles).not.toHaveBeenCalled()
  })

  test('uses path-attempt results without calling the backend when every file has a path', async () => {
    mocks.pathForDroppedFile.mockImplementation((f) => `/abs/${f.name}`)
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const a = new File([new Uint8Array([1])], 'a.png')
    const b = new File([new Uint8Array([2])], 'b.png')
    await expect(resolvePastedFiles([a, b])).resolves.toEqual({
      paths: ['/abs/a.png', '/abs/b.png'],
      failed: 0,
    })
    expect(mocks.saveClipboardFiles).not.toHaveBeenCalled()
  })

  test('falls through to blob save for files with no resolvable path', async () => {
    mocks.pathForDroppedFile.mockReturnValue('')
    mocks.saveClipboardFiles.mockResolvedValue(['/tmp/x.bin'])
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const f = new File([new Uint8Array([1])], 'x.bin')
    await expect(resolvePastedFiles([f])).resolves.toEqual({ paths: ['/tmp/x.bin'], failed: 0 })
    expect(mocks.saveClipboardFiles).toHaveBeenCalledWith([f])
  })

  test('concatenates path-attempt successes and backend results', async () => {
    mocks.pathForDroppedFile.mockImplementation((f) => (f.name === 'a' ? '/abs/a' : ''))
    mocks.saveClipboardFiles.mockResolvedValue(['/tmp/b'])
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const a = new File([new Uint8Array([1])], 'a')
    const b = new File([new Uint8Array([1])], 'b')
    await expect(resolvePastedFiles([a, b])).resolves.toEqual({
      paths: ['/abs/a', '/tmp/b'],
      failed: 0,
    })
    expect(mocks.saveClipboardFiles).toHaveBeenCalledWith([b])
  })

  test('counts blobs the backend dropped as failed (partial failure)', async () => {
    mocks.pathForDroppedFile.mockReturnValue('')
    mocks.saveClipboardFiles.mockResolvedValue(['/tmp/only.bin'])
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const a = new File([new Uint8Array([1])], 'a.bin')
    const b = new File([new Uint8Array([2])], 'b.bin')
    await expect(resolvePastedFiles([a, b])).resolves.toEqual({
      paths: ['/tmp/only.bin'],
      failed: 1,
    })
  })

  test('counts all blobs as failed when backend returns []', async () => {
    mocks.pathForDroppedFile.mockReturnValue('')
    mocks.saveClipboardFiles.mockResolvedValue([])
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const a = new File([new Uint8Array([1])], 'a.bin')
    const b = new File([new Uint8Array([2])], 'b.bin')
    await expect(resolvePastedFiles([a, b])).resolves.toEqual({ paths: [], failed: 2 })
  })

  test('does NOT count path-attempt failures as failed (they were the resolver, not the backend)', async () => {
    // If path-attempt failed and backend also failed, only the blob-save
    // miscount should be in `failed`. (Here: 0 path successes + 2 blob
    // inputs - 0 backend returns = 2 failed; not 4.)
    mocks.pathForDroppedFile.mockReturnValue('')
    mocks.saveClipboardFiles.mockResolvedValue([])
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const a = new File([new Uint8Array([1])], 'a')
    const b = new File([new Uint8Array([1])], 'b')
    const result = await resolvePastedFiles([a, b])
    expect(result.failed).toBe(2)
  })
})
