// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { DialogHostMount } from '#/web/components/ui/dialog-host-mount.tsx'

describe('DialogHostMount', () => {
  test('renders nothing when the mount target is missing', () => {
    const { container } = renderInJsdom(
      <DialogHostMount target={null}>{(target) => <div>{target}</div>}</DialogHostMount>,
    )

    expect(container.textContent).toBe('')
  })

  test('keeps children mounted while their own open state is false', () => {
    const { container } = renderInJsdom(
      <DialogHostMount target="/repo">
        {(target) => <div data-testid="hosted-dialog" data-target={target} data-open="false" />}
      </DialogHostMount>,
    )

    const hosted = container.querySelector('[data-testid="hosted-dialog"]')
    expect(hosted?.getAttribute('data-target')).toBe('/repo')
    expect(hosted?.getAttribute('data-open')).toBe('false')
  })
})
