import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
}))

vi.mock('execa', () => ({
  execa: mocks.execa,
}))

import { movePathToTrash } from '#/system/trash.ts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('movePathToTrash', () => {
  test('passes AbortSignal to execa as cancelSignal', async () => {
    const signal = new AbortController().signal
    mocks.execa.mockResolvedValueOnce({ exitCode: 0 })

    await expect(movePathToTrash('/tmp/file.txt', signal)).resolves.toEqual({
      ok: true,
      message: 'ok',
      repositoryStateChanged: true,
    })

    expect(mocks.execa).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ reject: true, cancelSignal: signal }),
    )
    expect(mocks.execa.mock.calls[0]?.[2]).not.toHaveProperty('signal')
  })

  test('reports Trash unavailable when every candidate command is missing', async () => {
    const err = Object.assign(new Error('missing'), { code: 'ENOENT' })
    mocks.execa.mockRejectedValue(err)

    await expect(movePathToTrash('/tmp/file.txt')).resolves.toEqual({
      ok: false,
      message: 'error.trash-unavailable',
    })
  })
})
