// @vitest-environment jsdom

import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { RepoReadNotice } from '#/web/components/RepoStatusFailureView.tsx'

describe('RepoReadNotice', () => {
  test('keeps idle failures retryable while another failed source is already fetching', async () => {
    const retryFetchingSource = vi.fn()
    const retryIdleSource = vi.fn()
    const user = userEvent.setup()

    renderInJsdom(
      <RepoReadNotice
        failures={[
          {
            messageKey: 'snapshot failed',
            stale: true,
            retrying: true,
            retry: retryFetchingSource,
          },
          {
            messageKey: 'status failed',
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

  test('reports a mixed stale and unavailable failure as unavailable', () => {
    renderInJsdom(
      <RepoReadNotice
        failures={[
          { messageKey: 'snapshot failed', stale: true, retrying: false },
          { messageKey: 'status failed', stale: false, retrying: false },
        ]}
      />,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
