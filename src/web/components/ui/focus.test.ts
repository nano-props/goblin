// Locks in the inset focus-ring convention documented in docs/ui-conventions.md.
// If a future PR reverts `focusRingInset` / `focusRingVisibleInset` to an outer
// ring, AnimateHeight's height-transition overflow:hidden starts clipping the
// focus halo again (regression that prompted the original fix in #57).
import { describe, expect, test } from 'vitest'
import { focusRingInset, focusRingVisibleInset } from '#/web/components/ui/focus.ts'

describe('focus ring utilities', () => {
  test('focusRingInset draws the ring inside the border box', () => {
    // The ring-inset modifier is what makes the ring clip-proof under
    // ancestor overflow:hidden. Without it, the box-shadow extends past
    // the border and gets sliced by AnimateHeight's height-transition
    // clipping.
    expect(focusRingInset).toContain('focus:ring-inset')
    expect(focusRingInset).toContain('focus:ring-2')
    expect(focusRingInset).toContain('focus:ring-ring')
  })

  test('focusRingVisibleInset draws the keyboard-only ring inside the border box', () => {
    expect(focusRingVisibleInset).toContain('focus-visible:ring-inset')
    expect(focusRingVisibleInset).toContain('focus-visible:ring-[3px]')
    expect(focusRingVisibleInset).toContain('focus-visible:ring-ring/50')
  })
})
