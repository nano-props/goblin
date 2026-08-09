// @vitest-environment jsdom

import { screen } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { RepoReadNotice } from '#/web/components/RepoReadNotice.tsx'

describe('RepoReadNotice', () => {
  test('retries only idle failures and disables retry while every source is fetching', async () => {
    const retryFetchingSource = vi.fn()
    const retryIdleSource = vi.fn()
    const user = userEvent.setup()

    const { rerender } = renderInJsdom(
      <RepoReadNotice
        failures={[
          {
            message: 'snapshot failed',
            stale: true,
            retrying: true,
            retry: retryFetchingSource,
          },
          {
            message: 'status failed',
            stale: true,
            retrying: false,
            retry: retryIdleSource,
          },
        ]}
      />,
    )

    const retryButton = screen.getByRole('button', { name: 'error.try-again' })
    expect(retryButton.getAttribute('disabled')).toBeNull()
    await user.click(retryButton)
    expect(retryFetchingSource).not.toHaveBeenCalled()
    expect(retryIdleSource).toHaveBeenCalledOnce()

    await rerender(
      <RepoReadNotice
        failures={[
          { message: 'snapshot failed', stale: true, retrying: true, retry: retryFetchingSource },
          { message: 'status failed', stale: true, retrying: true, retry: retryIdleSource },
        ]}
      />,
    )
    expect(retryButton.getAttribute('disabled')).not.toBeNull()
    await user.click(retryButton)
    expect(retryFetchingSource).not.toHaveBeenCalled()
    expect(retryIdleSource).toHaveBeenCalledOnce()
  })

  test('reports a mixed stale and unavailable failure as unavailable', () => {
    renderInJsdom(
      <RepoReadNotice
        failures={[
          { message: 'snapshot failed', stale: true, retrying: false },
          { message: 'status failed', stale: false, retrying: false },
        ]}
      />,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('preserves a shared message and generalizes distinct messages', async () => {
    const { rerender } = renderInJsdom(
      <RepoReadNotice
        failures={[
          { message: 'snapshot failed', stale: true, retrying: false },
          { message: 'snapshot failed', stale: true, retrying: false },
        ]}
      />,
    )

    expect(screen.getByText(/snapshot failed/)).toBeTruthy()
    await rerender(
      <RepoReadNotice
        failures={[
          { message: 'snapshot failed', stale: true, retrying: false },
          { message: 'status failed', stale: true, retrying: false },
        ]}
      />,
    )
    expect(screen.getByText(/error.failed-read-repo/)).toBeTruthy()
    expect(screen.queryByText(/snapshot failed/)).toBeNull()
  })
})
