import { describe, expect, test } from 'vitest'
import { collectClipboardFiles } from '#/web/clipboard/collect-clipboard-files.ts'

function mockDataTransfer(opts: { files?: File[]; items?: DataTransferItem[] }): DataTransfer {
  const files = opts.files ?? []
  const items = opts.items ?? []
  return {
    files: {
      length: files.length,
      item: (i: number) => files[i] ?? null,
      [Symbol.iterator]: function* () {
        for (const f of files) yield f
      },
    } as unknown as FileList,
    items: items as unknown as DataTransferItemList,
  } as DataTransfer
}

function fileItem(file: File): DataTransferItem {
  return {
    kind: 'file',
    type: file.type,
    getAsFile: () => file,
    getAsString: () => undefined,
    webkitGetAsEntry: () => null,
  } as unknown as DataTransferItem
}

function stringItem(text: string): DataTransferItem {
  return {
    kind: 'string',
    type: 'text/plain',
    getAsFile: () => null,
    getAsString: (cb: (text: string) => void) => cb(text),
    webkitGetAsEntry: () => null,
  } as unknown as DataTransferItem
}

describe('collectClipboardFiles', () => {
  test('returns [] when data is null', () => {
    expect(collectClipboardFiles(null)).toEqual([])
  })

  test('prefers data.files over data.items when both are present', () => {
    const a = new File([new Uint8Array([1])], 'a.png')
    const b = new File([new Uint8Array([2])], 'b.png')
    const dt = mockDataTransfer({ files: [a], items: [fileItem(b)] })
    const result = collectClipboardFiles(dt)
    expect(result).toEqual([a])
  })

  test('falls back to data.items when data.files is empty', () => {
    const a = new File([new Uint8Array([1])], 'a.png')
    const dt = mockDataTransfer({ files: [], items: [fileItem(a)] })
    expect(collectClipboardFiles(dt)).toEqual([a])
  })

  test('filters out zero-byte placeholder files', () => {
    const empty = new File([], 'placeholder.bin')
    const real = new File([new Uint8Array([1])], 'real.png')
    const dt = mockDataTransfer({ files: [empty, real] })
    expect(collectClipboardFiles(dt)).toEqual([real])
  })

  test('ignores string items in the items fallback', () => {
    const dt = mockDataTransfer({ files: [], items: [stringItem('hello'), stringItem('world')] })
    expect(collectClipboardFiles(dt)).toEqual([])
  })

  test('returns [] when neither files nor items have anything', () => {
    expect(collectClipboardFiles(mockDataTransfer({}))).toEqual([])
  })
})
