// @vitest-environment jsdom

import { screen } from '@testing-library/vue'
import { describe, expect, test, vi } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { RepoReadNotificationCard } from '#/web/components/repo-workspace/RepoReadNotificationCard.tsx'

describe('RepoReadNotificationCard', () => {
  test('exposes retry and dismiss actions', async () => {
    const retry = vi.fn()
    const dismiss = vi.fn()
    renderInJsdom(
      <RepoReadNotificationCard
        kind="stale"
        title="Showing stale changes"
        description="Failed to read repository"
        retryLabel="Try again"
        dismissLabel="Dismiss notification"
        retrying={false}
        onRetry={retry}
        onDismiss={dismiss}
      />,
    )

    expect(screen.getByText('Showing stale changes')).toBeTruthy()
    expect(screen.getByText('Failed to read repository')).toBeTruthy()
    await flushTestUpdates(() => screen.getByRole<HTMLButtonElement>('button', { name: 'Try again' }).click())
    expect(retry).toHaveBeenCalledOnce()
    await flushTestUpdates(() =>
      screen.getByRole<HTMLButtonElement>('button', { name: 'Dismiss notification' }).click(),
    )
    expect(dismiss).toHaveBeenCalledOnce()
  })

  test('disables retry while recovery is in progress', () => {
    renderInJsdom(
      <RepoReadNotificationCard
        kind="unavailable"
        title="Failed to read repository"
        retryLabel="Try again"
        dismissLabel="Dismiss notification"
        retrying
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Try again' }).disabled).toBe(true)
  })
})
