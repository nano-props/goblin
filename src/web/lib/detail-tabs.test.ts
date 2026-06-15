import { describe, expect, test } from 'vitest'
import { computeEffectiveDetailTab } from '#/web/lib/detail-tabs.ts'

describe('computeEffectiveDetailTab', () => {
  test('preserves a non-terminal preference verbatim', () => {
    expect(computeEffectiveDetailTab('status', true, 0, false)).toBe('status')
    expect(computeEffectiveDetailTab('changes', true, 0, false)).toBe('changes')
  })

  test('falls back to status when no worktree exists, regardless of preference', () => {
    expect(computeEffectiveDetailTab('terminal', false, 0, true)).toBe('status')
    expect(computeEffectiveDetailTab('terminal', false, 5, true)).toBe('status')
  })

  test('preserves the terminal preference when sync has not yet settled', () => {
    // syncReady=false means we don't yet know the session count; avoid
    // flashing status → terminal → status during boot.
    expect(computeEffectiveDetailTab('terminal', true, 0, false)).toBe('terminal')
  })

  test('keeps the terminal preference when the active worktree has at least one session', () => {
    expect(computeEffectiveDetailTab('terminal', true, 1, true)).toBe('terminal')
    expect(computeEffectiveDetailTab('terminal', true, 7, true)).toBe('terminal')
  })

  test('dismisses the terminal preference to status when sync has settled and the worktree is empty', () => {
    expect(computeEffectiveDetailTab('terminal', true, 0, true)).toBe('status')
  })

  test('keeps terminal renderable while a create request is pending', () => {
    expect(computeEffectiveDetailTab('terminal', true, 0, true, true)).toBe('terminal')
  })

  test('does not dismiss terminal when sync settled with non-zero sessions', () => {
    expect(computeEffectiveDetailTab('terminal', true, 1, true)).toBe('terminal')
  })

  test('is total over the four inputs', () => {
    const cases: Array<[Parameters<typeof computeEffectiveDetailTab>, ReturnType<typeof computeEffectiveDetailTab>]> = [
      [['status', true, 0, true], 'status'],
      [['status', false, 0, false], 'status'],
      [['changes', true, 0, true], 'changes'],
      [['changes', false, 0, true], 'changes'],
      [['terminal', false, 0, true], 'status'],
      [['terminal', true, 0, false], 'terminal'],
      [['terminal', true, 0, true], 'status'],
      [['terminal', true, 0, true, true], 'terminal'],
      [['terminal', true, 3, true], 'terminal'],
    ]
    for (const [input, expected] of cases) {
      expect(computeEffectiveDetailTab(...input)).toBe(expected)
    }
  })
})
