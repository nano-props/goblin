// @vitest-environment jsdom

import { defineComponent } from 'vue'
import { waitFor } from '@testing-library/vue'
import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { provideBootstrapLoadingPresentation } from '#/web/app/bootstrap/bootstrap-loading-presentation.ts'
import type { BootstrapLoadingPresentation } from '#/web/app/bootstrap/bootstrap-loading-presentation.ts'

describe('bootstrap loading presentation', () => {
  test('creates independent initial visibility for each root scope', async () => {
    const first = { presentation: null as BootstrapLoadingPresentation | null }
    const firstView = renderInJsdom(
      <BootstrapLoadingProbe onProvide={(presentation) => (first.presentation = presentation)} />,
    )

    expect(firstView.getByTestId('bootstrap-loading-visible').textContent).toBe('true')
    first.presentation?.hide()
    await waitFor(() => expect(firstView.getByTestId('bootstrap-loading-visible').textContent).toBe('false'))
    firstView.unmount()

    const second = { presentation: null as BootstrapLoadingPresentation | null }
    const secondView = renderInJsdom(
      <BootstrapLoadingProbe onProvide={(presentation) => (second.presentation = presentation)} />,
    )

    expect(secondView.getByTestId('bootstrap-loading-visible').textContent).toBe('true')
    expect(second.presentation).not.toBe(first.presentation)
  })
})

const BootstrapLoadingProbe = defineComponent<{
  onProvide: (presentation: BootstrapLoadingPresentation) => void
}>({
  name: 'BootstrapLoadingProbe',
  props: ['onProvide'],
  setup(props) {
    const presentation = provideBootstrapLoadingPresentation()
    props.onProvide(presentation)
    return () => <span data-testid="bootstrap-loading-visible">{String(presentation.visible.value)}</span>
  },
})
