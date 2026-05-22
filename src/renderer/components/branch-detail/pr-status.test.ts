import { describe, expect, test } from 'bun:test'
import {
  prChipTone,
  visiblePrHealthSignals,
  type PrHealthSignal,
} from '#/renderer/components/branch-detail/pr-status.ts'
import type { PullRequestInfo } from '#/shared/git-types.ts'

function pr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 1,
    title: 'PR',
    url: 'https://github.com/acme/repo/pull/1',
    state: 'open',
    ...overrides,
  }
}

const success: PrHealthSignal = { tone: 'success', label: 'checks' }
const neutral: PrHealthSignal = { tone: 'neutral', label: 'checks' }
const warning: PrHealthSignal = { tone: 'warning', label: 'checks' }

describe('prChipTone', () => {
  test('uses brand for an open PR without health signals', () => {
    expect(prChipTone(pr(), [])).toBe('brand')
  })

  test('uses success only when an open non-draft PR has all-success signals', () => {
    expect(prChipTone(pr(), [success])).toBe('success')
    expect(prChipTone(pr({ isDraft: true }), [success])).toBe('neutral')
  })

  test('uses neutral when any health signal is pending or unknown', () => {
    expect(prChipTone(pr(), [success, neutral])).toBe('neutral')
  })

  test('uses warning for closed PRs or warning health signals', () => {
    expect(prChipTone(pr({ state: 'closed' }), [success])).toBe('warning')
    expect(prChipTone(pr(), [warning])).toBe('warning')
  })

  test('uses success for merged PRs', () => {
    expect(prChipTone(pr({ state: 'merged' }), [warning])).toBe('success')
  })

  test('uses warning for closed PRs even when health signals succeeded', () => {
    expect(prChipTone(pr({ state: 'closed' }), [success])).toBe('warning')
  })
})

describe('visiblePrHealthSignals', () => {
  test('hides health signals once a PR is merged or closed', () => {
    const signals = [warning, success, neutral]

    expect(visiblePrHealthSignals(pr(), signals)).toEqual(signals)
    expect(visiblePrHealthSignals(pr({ state: 'merged' }), signals)).toEqual([])
    expect(visiblePrHealthSignals(pr({ state: 'closed' }), signals)).toEqual([])
  })
})
