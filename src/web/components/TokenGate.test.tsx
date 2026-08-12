// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TokenGate } from '#/web/components/TokenGate.tsx'
import { postServerCommandJson } from '#/web/lib/server-fetch.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const authMock = vi.hoisted(() => ({
  status: {
    state: 'unauthenticated' as 'checking' | 'authenticated' | 'unauthenticated',
    refresh: vi.fn(),
  },
}))

vi.mock('#/web/auth/AuthProvider.tsx', () => ({
  useAuth: () => authMock.status,
}))

vi.mock('#/web/lib/server-fetch.ts', () => ({
  postServerCommandJson: vi.fn(),
}))

beforeEach(() => {
  authMock.status.state = 'unauthenticated'
  authMock.status.refresh = vi.fn()
  vi.mocked(postServerCommandJson).mockReset()
})

describe('TokenGate', () => {
  test('passes through authenticated children', () => {
    authMock.status.state = 'authenticated'

    renderInJsdom(
      <TokenGate>
        <div>private app</div>
      </TokenGate>,
    )

    expect(screen.getByText('private app')).toBeTruthy()
  })

  test('shows an empty-token error without calling the server', async () => {
    const user = userEvent.setup()
    renderLoginForm()

    await user.click(screen.getByRole('button', { name: 'auth.gate.sign-in' }))

    expect(screen.getByText('auth.gate.error-empty')).toBeTruthy()
    expect(postServerCommandJson).not.toHaveBeenCalled()
  })

  test('surfaces login failures', async () => {
    const user = userEvent.setup()
    vi.mocked(postServerCommandJson).mockRejectedValueOnce(new Error('bad token'))
    renderLoginForm()

    await user.type(screen.getByRole('textbox', { name: 'auth.gate.token-label' }), 'bad-token')
    await user.click(screen.getByRole('button', { name: 'auth.gate.sign-in' }))

    await waitFor(() => {
      expect(screen.getByText('bad token')).toBeTruthy()
    })
    expect(postServerCommandJson).toHaveBeenCalledWith('/api/login', { token: 'bad-token' }, expect.any(Function), {
      signal: expect.any(AbortSignal),
    })
  })

  test('hides the previous error while a retry is pending', async () => {
    const user = userEvent.setup()
    const retry = Promise.withResolvers<{ ok: true }>()
    vi.mocked(postServerCommandJson).mockRejectedValueOnce(new Error('bad token')).mockReturnValueOnce(retry.promise)
    renderLoginForm()

    await user.type(screen.getByRole('textbox', { name: 'auth.gate.token-label' }), 'bad-token')
    await user.click(screen.getByRole('button', { name: 'auth.gate.sign-in' }))

    await waitFor(() => {
      expect(screen.getByText('bad token')).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: 'auth.gate.sign-in' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'auth.gate.signing-in' })).toBeTruthy()
    })
    expect(screen.queryByText('bad token')).toBeNull()

    await flushTestUpdates(async () => {
      retry.resolve({ ok: true })
      await retry.promise
    })
  })

  test('posts the token and refreshes auth state after a successful login', async () => {
    const user = userEvent.setup()
    vi.mocked(postServerCommandJson).mockResolvedValueOnce({ ok: true })
    renderLoginForm()

    await user.type(screen.getByRole('textbox', { name: 'auth.gate.token-label' }), 'good-token')
    await user.click(screen.getByRole('button', { name: 'auth.gate.sign-in' }))

    await waitFor(() => {
      expect(postServerCommandJson).toHaveBeenCalledWith('/api/login', { token: 'good-token' }, expect.any(Function), {
        signal: expect.any(AbortSignal),
      })
      expect(authMock.status.refresh).toHaveBeenCalledTimes(1)
    })
  })
})

function renderLoginForm() {
  return renderInJsdom(
    <TokenGate>
      <div>private app</div>
    </TokenGate>,
  )
}
