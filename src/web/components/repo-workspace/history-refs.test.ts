import { describe, expect, test } from 'vitest'
import { historyRefDisplays, parseHistoryRefs } from '#/web/components/repo-workspace/history-refs.ts'

describe('parseHistoryRefs', () => {
  test('splits comma-separated refs and drops blanks', () => {
    expect(parseHistoryRefs('HEAD -> main, origin/main,  , tag: v1')).toEqual([
      'HEAD -> main',
      'origin/main',
      'tag: v1',
    ])
  })
})

describe('historyRefDisplays', () => {
  test('merges a local branch with same-name remote refs', () => {
    expect(historyRefDisplays(['origin/main', 'main'])).toEqual([
      {
        kind: 'mergedRemote',
        refName: 'main',
        label: 'main',
        tone: 'success',
        remoteNames: ['origin'],
        remoteRefs: ['origin/main'],
      },
    ])
  })

  test('merges HEAD branch labels with same-name remote refs', () => {
    expect(historyRefDisplays(['HEAD -> feature/a', 'origin/feature/a'])).toEqual([
      {
        kind: 'mergedRemote',
        refName: 'HEAD -> feature/a',
        label: 'HEAD → feature/a',
        tone: 'brand',
        remoteNames: ['origin'],
        remoteRefs: ['origin/feature/a'],
      },
    ])
  })

  test('keeps remote refs separate when the local branch is absent', () => {
    expect(historyRefDisplays(['origin/main', 'origin/HEAD'])).toEqual([
      { kind: 'single', refName: 'origin/main', tone: 'warning' },
      { kind: 'single', refName: 'origin/HEAD', tone: 'warning' },
    ])
  })

  test('uses each matching remote ref in only one local display', () => {
    expect(historyRefDisplays(['HEAD -> main', 'origin/main', 'main'])).toEqual([
      {
        kind: 'mergedRemote',
        refName: 'HEAD -> main',
        label: 'HEAD → main',
        tone: 'brand',
        remoteNames: ['origin'],
        remoteRefs: ['origin/main'],
      },
      { kind: 'single', refName: 'main', tone: 'success' },
    ])
  })

  test('summarizes multiple matching remotes on the local branch', () => {
    expect(historyRefDisplays(['origin/main', 'upstream/main', 'main'])).toEqual([
      {
        kind: 'mergedRemote',
        refName: 'main',
        label: 'main',
        tone: 'success',
        remoteNames: ['origin', 'upstream'],
        remoteRefs: ['origin/main', 'upstream/main'],
      },
    ])
  })
})
