// @vitest-environment jsdom

import { userEvent } from '@testing-library/user-event'
import { screen } from '@testing-library/vue'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ConfirmDialog } from '#/web/components/ConfirmDialog.tsx'

describe('ConfirmDialog', () => {
  test('reports one cancellation when the cancel action closes the dialog', async () => {
    const onCancel = vi.fn()
    renderInJsdom(
      <ConfirmDialog
        open
        title="Discard changes?"
        message="This action cannot be undone."
        confirmLabel="Discard"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    )

    await userEvent.setup().click(await screen.findByRole('button', { name: 'dialog.cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
