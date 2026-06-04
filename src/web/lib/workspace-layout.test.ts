import { describe, expect, test } from 'vitest'
import { effectiveWorkspaceLayout } from '#/web/lib/workspace-layout.ts'

describe('effectiveWorkspaceLayout', () => {
  test('keeps top-bottom on small screens', () => {
    expect(effectiveWorkspaceLayout('top-bottom', 'compact')).toBe('top-bottom')
  })

  test('downgrades left-right to top-bottom on small screens', () => {
    expect(effectiveWorkspaceLayout('left-right', 'compact')).toBe('top-bottom')
  })

  test('preserves left-right on larger screens', () => {
    expect(effectiveWorkspaceLayout('left-right', 'default')).toBe('left-right')
  })
})
