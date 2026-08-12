import { beforeEach, describe, expect, test } from 'vitest'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
import { postEmbeddedServerJson, requestEmbeddedServerJson } from '#/shared/embedded-server-client.ts'

const fetchMock = mockFetch()
const runtime = { url: 'http://127.0.0.1:32100', accessToken: 'secret' }

describe('embedded server client', () => {
  beforeEach(() => fetchMock.mockReset())

  test('preserves an explicit server rejection', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 })

    await expect(postEmbeddedServerJson(runtime, '/api/settings/prefs', {}, (value) => value)).rejects.toThrow(
      'Embedded server request failed (400)',
    )
  })

  test('classifies a transport failure as an uncertain request outcome', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection reset'))

    await expect(postEmbeddedServerJson(runtime, '/api/settings/prefs', {}, (value) => value)).rejects.toMatchObject({
      name: 'CodedError',
      code: 'OUTCOME_UNCERTAIN',
    })
  })

  test('classifies an invalid successful response as an uncertain request outcome', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })

    await expect(
      postEmbeddedServerJson(runtime, '/api/settings/prefs', {}, () => {
        throw new Error('invalid payload')
      }),
    ).rejects.toMatchObject({
      name: 'CodedError',
      code: 'OUTCOME_UNCERTAIN',
    })
  })

  test('does not imply an uncertain operation outcome for query failures', async () => {
    const transportError = new Error('connection reset')
    fetchMock.mockRejectedValueOnce(transportError)

    await expect(requestEmbeddedServerJson(runtime, '/api/settings', (value) => value)).rejects.toBe(transportError)

    const decodeError = new Error('invalid payload')
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    await expect(
      requestEmbeddedServerJson(runtime, '/api/settings', () => {
        throw decodeError
      }),
    ).rejects.toBe(decodeError)
  })
})
