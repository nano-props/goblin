import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  formatLocalWorkspaceLocation,
  formatRemoteWorkspaceTargetLocator,
  formatRemoteWorktreeLocator,
  formatWorkspaceDisplayLocation,
  formatWorkspaceSessionEntryLocator,
  workspaceNameFromLocator,
} from '#/shared/workspace-display-location.ts'

describe('workspace display locations', () => {
  test('derives the same workspace directory name for local and remote locators', () => {
    expect(workspaceNameFromLocator(workspaceIdForTest('goblin+file:///home/example/Documents'))).toBe('Documents')
    expect(workspaceNameFromLocator(workspaceIdForTest('goblin+ssh://prod/home/example/Documents'))).toBe('Documents')
    expect(workspaceNameFromLocator(workspaceIdForTest('goblin+file:///C:/Users/example/My%20Workspace'))).toBe(
      'My Workspace',
    )
    expect(workspaceNameFromLocator(workspaceIdForTest('goblin+file:///'))).toBe('/')
    expect(workspaceNameFromLocator(workspaceIdForTest('goblin+file:///C:/'))).toBe('C:\\')
  })

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

  test('formats workspace locations from the best available remote metadata', () => {
    expect(
      formatWorkspaceDisplayLocation(
        workspaceIdForTest('goblin+file:///Users/example/Developer/workspace'),
        '/Users/example',
        {
          user: 'git',
          host: 'example.test',
          remotePath: '/srv/workspace',
        },
      ),
    ).toBe('~/Developer/workspace')
    expect(
      formatWorkspaceDisplayLocation(
        workspaceIdForTest('goblin+file:///Users/example/Developer/workspace'),
        '/Users/example',
        null,
      ),
    ).toBe('~/Developer/workspace')
    expect(
      formatWorkspaceDisplayLocation(workspaceIdForTest('goblin+ssh://prod/srv/workspace'), '/Users/example'),
    ).toBe('prod:/srv/workspace')
    expect(
      formatWorkspaceDisplayLocation(workspaceIdForTest('goblin+ssh://prod/srv/workspace'), '/Users/example', {
        user: 'git',
        host: 'example.test',
        remotePath: '/srv/workspace',
      }),
    ).toBe('git@example.test:/srv/workspace')
    expect(
      formatWorkspaceDisplayLocation(workspaceIdForTest('goblin+ssh://prod/srv/workspace'), '/Users/example', {
        user: 'git',
        host: 'stale.example.test',
        remotePath: '/srv/other',
      }),
    ).toBe('prod:/srv/workspace')
    expect(
      formatWorkspaceDisplayLocation(
        workspaceIdForTest('goblin+file:///C:/Users/example/My%20Workspace'),
        'C:\\Users\\example',
      ),
    ).toBe('~\\My Workspace')
  })

  test('formats recent workspace session entry locators', () => {
    expect(
      formatWorkspaceSessionEntryLocator(
        { id: workspaceIdForTest('goblin+file:///Users/example/workspace') },
        '/Users/example',
      ),
    ).toBe('~/workspace')
    expect(
      formatWorkspaceSessionEntryLocator(
        { id: workspaceIdForTest('goblin+ssh://prod/srv/workspace') },
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
