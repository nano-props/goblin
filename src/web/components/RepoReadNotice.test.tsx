// @vitest-environment jsdom

import { screen } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
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

  test('reports membership changes as a neutral in-progress condition', () => {
    renderInJsdom(
      <RepoReadNotice
        failures={[
          {
            message: REPO_MEMBERSHIP_READ_CONFLICT_KEY,
            stale: false,
            retrying: false,
            retry: vi.fn(),
          },
        ]}
      />,
    )

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(REPO_MEMBERSHIP_READ_CONFLICT_KEY)).toBeTruthy()
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
