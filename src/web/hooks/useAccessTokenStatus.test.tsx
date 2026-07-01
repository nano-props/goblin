// @vitest-environment jsdom

import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useAccessTokenStatus } from '#/web/hooks/useAccessTokenStatus.ts'
import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

vi.mock('#/web/lib/server-fetch.ts', () => ({
  fetchServerJson: vi.fn(),
  postServerJson: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(fetchServerJson).mockReset()
  vi.mocked(postServerJson).mockReset()
  window.history.replaceState({}, '', '/')
})

describe('useAccessTokenStatus', () => {
  test('moves back to checking while a manual refresh probe is pending', async () => {
    const refreshProbe = createDeferred<{ ok: true }>()
    vi.mocked(fetchServerJson)
      .mockRejectedValueOnce(new Error('unauthorized'))
      .mockReturnValueOnce(refreshProbe.promise)

    renderInJsdom(<Harness />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'unauthenticated' })).toBeTruthy()
    })

    await act(async () => {
      screen.getByRole('button', { name: 'unauthenticated' }).click()
    })

    expect(screen.getByRole('button', { name: 'checking' })).toBeTruthy()
    expect(fetchServerJson).toHaveBeenCalledTimes(2)

    await act(async () => {
      refreshProbe.resolve({ ok: true })
      await refreshProbe.promise
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'authenticated' })).toBeTruthy()
    })
  })
})

function Harness() {
  const auth = useAccessTokenStatus()
  return (
    <button type="button" onClick={auth.refresh}>
      {auth.state}
    </button>
  )
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
