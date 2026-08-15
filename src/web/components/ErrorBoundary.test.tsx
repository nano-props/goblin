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
  test('reports a captured error so presentation owners can reveal the fallback', async () => {
    const renderError = new Error('render failed')
    const onError = vi.fn()
    const CrashingChild = defineComponent({
      setup() {
        return () => {
          throw renderError
        }
      },
    })

    const view = renderInJsdom(
      <ErrorBoundary onError={onError}>
        <CrashingChild />
      </ErrorBoundary>,
    )

    await waitFor(() => expect(view.getByText('render failed')).toBeTruthy())
    expect(onError).toHaveBeenCalledWith(renderError)
  })

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
