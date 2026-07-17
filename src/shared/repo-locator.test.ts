import { describe, expect, test } from 'vitest'
import {
  formatLocalRepoLocator,
  formatRemoteRepoRefLocator,
  formatRemoteRepoTargetLocator,
  formatRemoteWorktreeLocator,
  formatRepoLocator,
  formatWorkspaceSessionEntryLocator,
  toSafeCanonicalRepoLocator,
} from '#/shared/repo-locator.ts'

describe('toSafeCanonicalRepoLocator', () => {
  test.each(['goblin+file:///repo', 'goblin+ssh://host/repo'])('preserves canonical locator %s', (locator) =>
    expect(toSafeCanonicalRepoLocator(locator)).toBe(locator),
  )

  test.each(['', '/repo', 'C:\\repo', 'C:/repo', '\\\\server\\repo', 'relative/repo', 'repo\0suffix'] as const)(
    'rejects invalid locator %s',
    (locator) => {
      expect(toSafeCanonicalRepoLocator(locator)).toBeNull()
    },
  )
})

describe('repo locators', () => {
  test('formats local repo locators as tildified paths', () => {
    expect(formatLocalRepoLocator('/Users/example/Developer/repo', '/Users/example')).toBe('~/Developer/repo')
  })

  test('formats concrete remote target locators with connection identity', () => {
    expect(formatRemoteRepoTargetLocator({ user: 'git', host: 'example.test', remotePath: '/srv/repo' })).toBe(
      'git@example.test:/srv/repo',
    )
  })

  test('formats persisted remote ref locators with the SSH alias', () => {
    expect(formatRemoteRepoRefLocator({ alias: 'prod', remotePath: '/srv/repo' })).toBe('prod:/srv/repo')
  })

  test('formats repo locators from the best available remote metadata', () => {
    expect(
      formatRepoLocator('/Users/example/Developer/repo', '/Users/example', {
        user: 'git',
        host: 'example.test',
        remotePath: '/srv/repo',
      }),
    ).toBe('git@example.test:/srv/repo')
    expect(formatRepoLocator('/Users/example/Developer/repo', '/Users/example', null)).toBe('~/Developer/repo')
  })

  test('formats recent repo session entry locators', () => {
    expect(
      formatWorkspaceSessionEntryLocator({ kind: 'local', id: 'goblin+file:///Users/example/repo' }, '/Users/example'),
    ).toBe('~/repo')
    expect(
      formatWorkspaceSessionEntryLocator(
        {
          kind: 'remote',
          id: 'goblin+ssh://prod/srv/repo',
          ref: {
            id: 'goblin+ssh://prod/srv/repo',
            alias: 'prod',
            remotePath: '/srv/repo',
            displayName: 'prod:repo',
          },
        },
        '/Users/example',
      ),
    ).toBe('prod:/srv/repo')
  })

  test('formats remote worktree locators', () => {
    expect(formatRemoteWorktreeLocator({ user: 'git', host: 'example.test' }, '/srv/repo-feature')).toBe(
      'git@example.test:/srv/repo-feature',
    )
  })
})
