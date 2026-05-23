import { describe, expect, test } from 'vitest'
import { ellipsizeMiddlePath } from '#/renderer/lib/display-path.ts'

describe('ellipsizeMiddlePath', () => {
  test('keeps paths that fit unchanged', () => {
    expect(ellipsizeMiddlePath('apps/web/src/App.tsx', 20)).toBe('apps/web/src/App.tsx')
  })

  test('keeps the first segment and longest fitting suffix', () => {
    expect(ellipsizeMiddlePath('a/b/c/d/file.ts', 14)).toBe('a/…/d/file.ts')
  })

  test('drops repeated middle prefixes for deeply nested project paths', () => {
    expect(
      ellipsizeMiddlePath(
        'seller_promotion_platform/seller-promotion-platform/seller-promotion-platform-frontend/free-exposure-promotion/src/ui/i18n/m-en.yaml',
        60,
      ),
    ).toBe('seller_promotion_platform/…/src/ui/i18n/m-en.yaml')
  })

  test('falls back to middle ellipsis for long filenames', () => {
    expect(ellipsizeMiddlePath('very-long-filename.component.tsx', 12)).toBe('very-l…t.tsx')
  })

  test('never exceeds the requested character budget for tiny widths', () => {
    for (let maxChars = 0; maxChars <= 3; maxChars += 1) {
      expect(ellipsizeMiddlePath('apps/web/src/App.tsx', maxChars).length).toBeLessThanOrEqual(maxChars)
    }
  })

  test('normalizes invalid and fractional character budgets', () => {
    expect(ellipsizeMiddlePath('apps/web/src/App.tsx', Number.NaN)).toBe('')
    expect(ellipsizeMiddlePath('apps/web/src/App.tsx', 14.9)).toBe('apps/…/App.tsx')
  })
})
