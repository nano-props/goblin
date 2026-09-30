import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  MAX_PASTE_BATCH_BYTES,
  MAX_PASTE_UPLOAD_FILES,
  PASTE_FILE_MAX_BYTES,
  PasteFileLimitError,
} from '#/shared/clipboard-paste.ts'

const mocks = vi.hoisted(() => ({
  pathForDroppedFile: vi.fn<(file: File) => string>(),
  saveClipboardFiles: vi.fn<(files: File[]) => Promise<string[]>>(),
}))

vi.mock('#/web/app/shell-client.ts', () => ({
  pathForDroppedFile: mocks.pathForDroppedFile,
  saveClipboardFiles: mocks.saveClipboardFiles,
}))

describe('resolvePastedFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pathForDroppedFile.mockReturnValue('')
    mocks.saveClipboardFiles.mockResolvedValue([])
  })

  test('returns an empty resolution for empty input', async () => {
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    await expect(resolvePastedFiles([])).resolves.toEqual({ paths: [] })
    expect(mocks.saveClipboardFiles).not.toHaveBeenCalled()
  })

  test('falls through to blob save for files with no resolvable path', async () => {
    mocks.pathForDroppedFile.mockReturnValue('')
    mocks.saveClipboardFiles.mockResolvedValue(['/tmp/x.bin'])
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const f = new File([new Uint8Array([1])], 'x.bin')
    await expect(resolvePastedFiles([f])).resolves.toEqual({
      paths: ['/tmp/x.bin'],
    })
    expect(mocks.saveClipboardFiles).toHaveBeenCalledWith([f])
  })

  test('fails before upload when a blob exceeds the per-file limit', async () => {
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const file = new File([new Uint8Array([1])], 'archive.bin')
    Object.defineProperty(file, 'size', { value: PASTE_FILE_MAX_BYTES + 1 })
    await expect(resolvePastedFiles([file])).rejects.toEqual(new PasteFileLimitError('file'))
    expect(mocks.saveClipboardFiles).not.toHaveBeenCalled()
  })

  test('fails before upload when blob contents exceed the batch limit', async () => {
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const first = new File([new Uint8Array([1])], 'first.bin')
    const second = new File([new Uint8Array([1])], 'second.bin')
    Object.defineProperty(first, 'size', { value: MAX_PASTE_BATCH_BYTES / 2 + 1 })
    Object.defineProperty(second, 'size', { value: MAX_PASTE_BATCH_BYTES / 2 })
    await expect(resolvePastedFiles([first, second])).rejects.toEqual(new PasteFileLimitError('batch'))
    expect(mocks.saveClipboardFiles).not.toHaveBeenCalled()
  })

  test('fails before upload when the blob count exceeds the file limit', async () => {
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const files = Array.from({ length: MAX_PASTE_UPLOAD_FILES + 1 }, (_, index) => new File([], `empty-${index}.txt`))
    await expect(resolvePastedFiles(files)).rejects.toEqual(new PasteFileLimitError('count'))
    expect(mocks.saveClipboardFiles).not.toHaveBeenCalled()
  })

  test('accepts exactly the maximum blob count', async () => {
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const files = Array.from({ length: MAX_PASTE_UPLOAD_FILES }, (_, index) => new File([], `empty-${index}.txt`))
    const savedPaths = files.map((_, index) => `/tmp/empty-${index}.txt`)
    mocks.saveClipboardFiles.mockResolvedValue(savedPaths)

    await expect(resolvePastedFiles(files)).resolves.toEqual({ paths: savedPaths })
    expect(mocks.saveClipboardFiles).toHaveBeenCalledWith(files)
  })

  test('accepts blob contents exactly at the file and batch limits', async () => {
    mocks.saveClipboardFiles.mockResolvedValue(['/tmp/first.bin', '/tmp/second.bin'])
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const first = new File([new Uint8Array([1])], 'first.bin')
    const second = new File([new Uint8Array([1])], 'second.bin')
    Object.defineProperty(first, 'size', { value: PASTE_FILE_MAX_BYTES })
    Object.defineProperty(second, 'size', { value: MAX_PASTE_BATCH_BYTES - PASTE_FILE_MAX_BYTES })
    await expect(resolvePastedFiles([first, second])).resolves.toEqual({
      paths: ['/tmp/first.bin', '/tmp/second.bin'],
    })
    expect(mocks.saveClipboardFiles).toHaveBeenCalledWith([first, second])
  })

  test('rejects when the backend returns fewer paths than requested', async () => {
    mocks.pathForDroppedFile.mockReturnValue('')
    mocks.saveClipboardFiles.mockResolvedValue(['/tmp/only.bin'])
    const { resolvePastedFiles } = await import('#/web/clipboard/resolver.ts')
    const a = new File([new Uint8Array([1])], 'a.bin')
    const b = new File([new Uint8Array([2])], 'b.bin')
    await expect(resolvePastedFiles([a, b])).rejects.toThrow('Incomplete clipboard file response')
  })
})
