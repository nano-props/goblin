import { describe, expect, test } from 'vitest'
import {
  formatLocalRepoLocator,
  formatRemoteRepoRefLocator,
  formatRemoteRepoTargetLocator,
  formatRemoteWorktreeLocator,
  formatRepoLocator,
  formatRepoSessionEntryLocator,
} from '#/shared/repo-locator.ts'

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
    expect(formatRepoSessionEntryLocator({ kind: 'local', id: '/Users/example/repo' }, '/Users/example')).toBe('~/repo')
    expect(
      formatRepoSessionEntryLocator(
        {
          kind: 'remote',
          id: 'ssh-config://prod/srv/repo',
          ref: {
            id: 'ssh-config://prod/srv/repo',
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
