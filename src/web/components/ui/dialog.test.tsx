// @vitest-environment jsdom

import { DialogRoot } from 'reka-ui'
import { waitFor } from '@testing-library/vue'
import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { DialogContent } from '#/web/components/ui/dialog.tsx'

describe('DialogContent', () => {
  test('renders its portal above the bootstrap loading layer', async () => {
    renderInJsdom(
      <DialogRoot open>
        <DialogContent>Dialog body</DialogContent>
      </DialogRoot>,
    )

    await waitFor(() => expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull())
    expect(document.querySelector('[data-slot="dialog-overlay"]')?.className).toContain('z-50')
    expect(document.querySelector('[data-slot="dialog-content"]')?.className).toContain('z-50')
  })
})
