import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  formatLocalWorkspaceLocation,
  formatRemoteWorkspaceRefLocator,
  formatRemoteWorkspaceTargetLocator,
  formatRemoteWorktreeLocator,
  formatWorkspaceDisplayLocation,
  formatWorkspaceSessionEntryLocator,
} from '#/shared/workspace-display-location.ts'

describe('workspace display locations', () => {
  test('formats local workspace locations as tildified paths', () => {
    expect(formatLocalWorkspaceLocation('/Users/example/Developer/workspace', '/Users/example')).toBe(
      '~/Developer/workspace',
    )
  })

  test('formats concrete remote target locators with connection identity', () => {
    expect(formatRemoteWorkspaceTargetLocator({ user: 'git', host: 'example.test', remotePath: '/srv/repo' })).toBe(
      'git@example.test:/srv/repo',
    )
  })

  test('formats persisted remote ref locators with the SSH alias', () => {
    expect(formatRemoteWorkspaceRefLocator({ alias: 'prod', remotePath: '/srv/repo' })).toBe('prod:/srv/repo')
  })

  test('formats workspace locations from the best available remote metadata', () => {
    expect(
      formatWorkspaceDisplayLocation('goblin+file:///Users/example/Developer/workspace', '/Users/example', {
        user: 'git',
        host: 'example.test',
        remotePath: '/srv/workspace',
      }),
    ).toBe('~/Developer/workspace')
    expect(
      formatWorkspaceDisplayLocation('goblin+file:///Users/example/Developer/workspace', '/Users/example', null),
    ).toBe('~/Developer/workspace')
    expect(formatWorkspaceDisplayLocation('goblin+ssh://prod/srv/workspace', '/Users/example')).toBe(
      'prod:/srv/workspace',
    )
    expect(
      formatWorkspaceDisplayLocation('goblin+ssh://prod/srv/workspace', '/Users/example', {
        user: 'git',
        host: 'example.test',
        remotePath: '/srv/workspace',
      }),
    ).toBe('git@example.test:/srv/workspace')
    expect(
      formatWorkspaceDisplayLocation('goblin+ssh://prod/srv/workspace', '/Users/example', {
        user: 'git',
        host: 'stale.example.test',
        remotePath: '/srv/other',
      }),
    ).toBe('prod:/srv/workspace')
    expect(formatWorkspaceDisplayLocation('goblin+file:///C:/Users/example/My%20Workspace', 'C:\\Users\\example')).toBe(
      '~\\My Workspace',
    )
  })

  test('formats recent workspace session entry locators', () => {
    expect(
      formatWorkspaceSessionEntryLocator(
        { kind: 'local', id: workspaceIdForTest('goblin+file:///Users/example/workspace') },
        '/Users/example',
      ),
    ).toBe('~/workspace')
    expect(
      formatWorkspaceSessionEntryLocator(
        {
          kind: 'remote',
          id: workspaceIdForTest('goblin+ssh://prod/srv/workspace'),
          ref: {
            id: workspaceIdForTest('goblin+ssh://prod/srv/workspace'),
            alias: 'prod',
            remotePath: '/srv/workspace',
            displayName: 'prod:workspace',
          },
        },
        '/Users/example',
      ),
    ).toBe('prod:/srv/workspace')
  })

  test('formats remote worktree locators', () => {
    expect(formatRemoteWorktreeLocator({ user: 'git', host: 'example.test' }, '/srv/workspace-feature')).toBe(
      'git@example.test:/srv/workspace-feature',
    )
  })
})
