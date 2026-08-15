// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/vue'
import { defineComponent, reactive } from 'vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TokenGate } from '#/web/components/TokenGate.tsx'
import { provideBootstrapLoadingPresentation } from '#/web/app/bootstrap/bootstrap-loading-presentation.ts'
import { postServerCommandJson } from '#/web/lib/server-fetch.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const authMock = vi.hoisted(() => ({
  status: null as unknown as {
    state: 'checking' | 'authenticated' | 'unauthenticated'
    refresh: ReturnType<typeof vi.fn>
  },
}))

vi.mock('#/web/auth/AuthProvider.tsx', () => ({
  useAuth: () => authMock.status,
}))

vi.mock('#/web/lib/server-fetch.ts', () => ({
  postServerCommandJson: vi.fn(),
}))

beforeEach(() => {
  authMock.status = reactive({
    state: 'unauthenticated' as 'checking' | 'authenticated' | 'unauthenticated',
    refresh: vi.fn(),
  })
  vi.mocked(postServerCommandJson).mockReset()
})

describe('TokenGate', () => {
  test('passes through authenticated children', () => {
    authMock.status.state = 'authenticated'

    renderTokenGate()

    expect(screen.getByText('private app')).toBeTruthy()
    expect(screen.getByTestId('bootstrap-loading-visible').textContent).toBe('true')
  })

  test('leaves the bootstrap loading presentation visible while authentication is checking', () => {
    authMock.status.state = 'checking'

    const result = renderTokenGate()

    expect(result.container.querySelector('[role="status"]')).toBeNull()
    expect(screen.getByTestId('bootstrap-loading-visible').textContent).toBe('true')
  })

  test('hides the bootstrap loading presentation before showing login', async () => {
    renderTokenGate()

    expect(screen.getByRole('button', { name: 'auth.gate.sign-in' })).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('bootstrap-loading-visible').textContent).toBe('false'))
  })

  test('reactivates loading for login auth checking and leaves it active for the workspace handoff', async () => {
    renderTokenGate()
    await waitFor(() => expect(screen.getByTestId('bootstrap-loading-visible').textContent).toBe('false'))

    authMock.status.state = 'checking'
    await waitFor(() => expect(screen.getByTestId('bootstrap-loading-visible').textContent).toBe('true'))

    authMock.status.state = 'authenticated'
    await waitFor(() => expect(screen.getByText('private app')).toBeTruthy())
    expect(screen.getByTestId('bootstrap-loading-visible').textContent).toBe('true')
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
  return renderTokenGate()
}

function renderTokenGate() {
  return renderInJsdom(
    <BootstrapLoadingTestScope>
      <TokenGate>
        <div>private app</div>
      </TokenGate>
    </BootstrapLoadingTestScope>,
  )
}

const BootstrapLoadingTestScope = defineComponent({
  name: 'BootstrapLoadingTestScope',
  setup(_props, { slots }) {
    const bootstrapLoading = provideBootstrapLoadingPresentation()
    return () => (
      <>
        <span data-testid="bootstrap-loading-visible">{String(bootstrapLoading.visible.value)}</span>
        {slots.default?.()}
      </>
    )
  },
})
