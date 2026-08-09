// @vitest-environment jsdom

import { defineComponent } from 'vue'
import { describe, expect, test, vi } from 'vitest'
import { waitFor } from '@testing-library/vue'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ErrorBoundary } from '#/web/components/ErrorBoundary.tsx'

const fallbackButton = vi.hoisted(() => ({ error: null as Error | null }))

vi.mock('#/web/components/ui/button.tsx', () => ({
  Button: () => {
    const error = fallbackButton.error
    fallbackButton.error = null
    if (error) throw error
    return null
  },
}))

describe('ErrorBoundary', () => {
  test('lets an error in its fallback propagate to the outer boundary', async () => {
    const renderError = new Error('inner render failed')
    const fallbackError = new Error('inner fallback failed')
    fallbackButton.error = fallbackError
    const CrashingChild = defineComponent({
      name: 'CrashingChild',
      setup() {
        return () => {
          throw renderError
        }
      },
    })

    const view = renderInJsdom(
      <ErrorBoundary>
        <ErrorBoundary>
          <CrashingChild />
        </ErrorBoundary>
      </ErrorBoundary>,
    )

    await waitFor(() => expect(view.getByText('inner fallback failed')).toBeTruthy())
    expect(view.queryByText('inner render failed')).toBeNull()
  })
})
