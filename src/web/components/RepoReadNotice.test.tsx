// @vitest-environment jsdom

import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { RepoReadNotice } from '#/web/components/RepoReadNotice.tsx'

describe('RepoReadNotice', () => {
  test('keeps idle failures retryable while another failed source is already fetching', async () => {
    const retryFetchingSource = vi.fn()
    const retryIdleSource = vi.fn()
    const user = userEvent.setup()

    renderInJsdom(
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
  })

  test('disables retry while every retryable failure is fetching', async () => {
    const retrySnapshot = vi.fn()
    const retryStatus = vi.fn()
    const user = userEvent.setup()

    renderInJsdom(
      <RepoReadNotice
        failures={[
          { message: 'snapshot failed', stale: true, retrying: true, retry: retrySnapshot },
          { message: 'status failed', stale: true, retrying: true, retry: retryStatus },
        ]}
      />,
    )

    const retryButton = screen.getByRole('button', { name: 'error.try-again' })
    expect(retryButton.getAttribute('disabled')).not.toBeNull()
    await user.click(retryButton)
    expect(retrySnapshot).not.toHaveBeenCalled()
    expect(retryStatus).not.toHaveBeenCalled()
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

  test('omits retry when no failed source exposes one', () => {
    renderInJsdom(<RepoReadNotice failures={[{ message: 'status failed', stale: true, retrying: false }]} />)

    expect(screen.queryByRole('button', { name: 'error.try-again' })).toBeNull()
  })

  test('preserves a shared message and generalizes distinct messages', () => {
    const { rerender } = renderInJsdom(
      <RepoReadNotice
        failures={[
          { message: 'snapshot failed', stale: true, retrying: false },
          { message: 'snapshot failed', stale: true, retrying: false },
        ]}
      />,
    )

    expect(screen.getByText(/snapshot failed/)).toBeTruthy()
    rerender(
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

  test('does not present a membership transition as the sole cause of a mixed failure', () => {
    renderInJsdom(
      <RepoReadNotice
        failures={[
          { message: REPO_MEMBERSHIP_READ_CONFLICT_KEY, stale: true, retrying: false },
          { message: 'status failed', stale: true, retrying: false },
        ]}
      />,
    )

    expect(screen.getByText(/error.failed-read-repo/)).toBeTruthy()
    expect(screen.queryByText(REPO_MEMBERSHIP_READ_CONFLICT_KEY)).toBeNull()
  })

  test('renders nothing without failures', () => {
    const { container } = renderInJsdom(<RepoReadNotice failures={[]} />)
    expect(container.textContent).toBe('')
  })
})
