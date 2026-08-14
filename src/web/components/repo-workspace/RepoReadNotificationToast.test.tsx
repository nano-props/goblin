// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from '@testing-library/vue'
import { describe, expect, test, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { RepoReadNotificationToast } from '#/web/components/repo-workspace/RepoReadNotificationToast.tsx'
import { Toaster } from '#/web/components/ui/sonner.tsx'

describe('RepoReadNotificationToast', () => {
  test('renders stale reads with persistent warning actions', async () => {
    const retry = vi.fn()
    const closeToast = vi.fn()
    const { container } = renderInJsdom(
      <RepoReadNotificationToast
        kind="stale"
        title="Showing stale changes"
        description="Failed to read repository"
        retryLabel="Try again"
        dismissLabel="Dismiss notification"
        retrying={false}
        onRetry={retry}
        onCloseToast={closeToast}
      />,
    )

    const notification = screen.getByTestId('repo-read-notification')
    expect(notification.getAttribute('role')).toBeNull()
    expect(notification.classList.contains('rounded-md')).toBe(true)
    expect(notification.classList.contains('shadow-md')).toBe(true)
    expect(notification.classList.contains('border-warning-border')).toBe(true)
    expect(container.querySelector('.bg-warning-surface\\/50')).not.toBeNull()
    expect(container.querySelector('.lucide-triangle-alert')).not.toBeNull()

    await flushTestUpdates(() => screen.getByRole<HTMLButtonElement>('button', { name: 'Try again' }).click())
    expect(retry).toHaveBeenCalledOnce()
    await flushTestUpdates(() =>
      screen.getByRole<HTMLButtonElement>('button', { name: 'Dismiss notification' }).click(),
    )
    expect(closeToast).toHaveBeenCalledOnce()
  })

  test('distinguishes membership transitions from unavailable reads', async () => {
    const closeToast = vi.fn()
    const view = renderInJsdom(
      <RepoReadNotificationToast
        kind="membership-changing"
        title="Repository membership is changing"
        retryLabel="Try again"
        dismissLabel="Dismiss notification"
        retrying={false}
        onCloseToast={closeToast}
      />,
    )

    expect(screen.getByTestId('repo-read-notification').classList.contains('border-border')).toBe(true)
    expect(view.container.querySelector('.bg-muted\\/35')).not.toBeNull()
    expect(view.container.querySelector('.lucide-refresh-cw')).not.toBeNull()

    await view.rerender(
      <RepoReadNotificationToast
        kind="unavailable"
        title="Failed to read repository"
        retryLabel="Try again"
        dismissLabel="Dismiss notification"
        retrying={false}
        onCloseToast={closeToast}
      />,
    )
    expect(screen.getByTestId('repo-read-notification').classList.contains('border-danger-border')).toBe(true)
    expect(view.container.querySelector('.bg-danger-surface\\/50')).not.toBeNull()
    expect(view.container.querySelector('.lucide-circle-x')).not.toBeNull()
  })

  test('uses the close callback injected by Sonner', async ({ onTestFinished }) => {
    const view = renderInJsdom(<Toaster />)
    const dismissed = vi.fn()
    const toastId = toast.custom(RepoReadNotificationToast, {
      duration: Number.POSITIVE_INFINITY,
      onDismiss: dismissed,
      componentProps: {
        kind: 'stale',
        title: 'Showing stale changes',
        retryLabel: 'Try again',
        dismissLabel: 'Dismiss notification',
        retrying: false,
      },
    })
    onTestFinished(async () => {
      toast.dismiss(toastId)
      await view.flushAnimationFrames()
    })

    await fireEvent.click(await screen.findByRole('button', { name: 'Dismiss notification' }))

    await waitFor(() => expect(dismissed).toHaveBeenCalledOnce())
  })
})
