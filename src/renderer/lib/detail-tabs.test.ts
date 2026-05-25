import { describe, expect, test } from 'vitest'
import {
  adjacentDetailTab,
  detailTabForWorktree,
  detailTabNavigationKey,
  navigatedDetailTab,
  visibleDetailTabs,
} from '#/renderer/lib/detail-tabs.ts'

describe('visibleDetailTabs', () => {
  test('includes terminal only when the selected branch has a worktree', () => {
    expect(visibleDetailTabs(true).map((tab) => tab.id)).toEqual(['status', 'changes', 'commits', 'terminal'])
    expect(visibleDetailTabs(false).map((tab) => tab.id)).toEqual(['status', 'changes', 'commits'])
  })
})

describe('detailTabNavigationKey', () => {
  test('accepts tab navigation keys only', () => {
    expect(detailTabNavigationKey('ArrowRight')).toBe('ArrowRight')
    expect(detailTabNavigationKey('ArrowLeft')).toBe('ArrowLeft')
    expect(detailTabNavigationKey('Home')).toBe('Home')
    expect(detailTabNavigationKey('End')).toBe('End')
    expect(detailTabNavigationKey('ArrowUp')).toBeNull()
  })
})

describe('detailTabForWorktree', () => {
  test('falls back from terminal when the selected branch has no worktree', () => {
    expect(detailTabForWorktree('terminal', false)).toBe('status')
    expect(detailTabForWorktree('terminal', true)).toBe('terminal')
    expect(detailTabForWorktree('commits', false)).toBe('commits')
  })
})

describe('navigatedDetailTab', () => {
  test('wraps left and right within the visible detail tabs', () => {
    expect(navigatedDetailTab('status', 'ArrowLeft', true)).toBe('terminal')
    expect(navigatedDetailTab('terminal', 'ArrowRight', true)).toBe('status')
    expect(navigatedDetailTab('status', 'ArrowLeft', false)).toBe('commits')
    expect(navigatedDetailTab('commits', 'ArrowRight', false)).toBe('status')
  })

  test('jumps to first and last visible detail tabs', () => {
    expect(navigatedDetailTab('changes', 'Home', true)).toBe('status')
    expect(navigatedDetailTab('changes', 'End', true)).toBe('terminal')
    expect(navigatedDetailTab('changes', 'End', false)).toBe('commits')
  })

  test('navigates from the first visible tab when the current tab is hidden', () => {
    expect(navigatedDetailTab('terminal', 'ArrowRight', false)).toBe('changes')
    expect(navigatedDetailTab('terminal', 'ArrowLeft', false)).toBe('commits')
    expect(navigatedDetailTab('terminal', 'Home', false)).toBe('status')
    expect(navigatedDetailTab('terminal', 'End', false)).toBe('commits')
  })

  test('preserves adjacentDetailTab behavior for global shortcuts', () => {
    expect(adjacentDetailTab('status', 1, true)).toBe('changes')
    expect(adjacentDetailTab('status', -1, false)).toBe('commits')
    expect(adjacentDetailTab('commits', 1, false)).toBe('status')
  })
})
