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
      result: { ok: true, message: 'ok' },
      execution: { status: 'succeeded' },
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
      result: { ok: false, message: 'error.trash-unavailable' },
      execution: { status: 'not-started' },
    })
  })

  test('marks cancellation after command invocation as uncertain', async () => {
    const controller = new AbortController()
    mocks.execa.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('cancelled')
    })

    await expect(movePathToTrash('/tmp/file.txt', controller.signal)).resolves.toEqual({
      result: { ok: false, message: 'cancelled' },
      execution: { status: 'cancelled' },
    })
  })

  test('preserves an invoked trash tool rejection', async () => {
    mocks.execa.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EPERM' }))

    await expect(movePathToTrash('/tmp/file.txt')).resolves.toEqual({
      result: { ok: false, message: 'permission denied' },
      execution: { status: 'failed' },
    })
    expect(mocks.execa).toHaveBeenCalledTimes(1)
  })
})
