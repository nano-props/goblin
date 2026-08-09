import { describe, expect, test } from 'vitest'
import {
  formatTerminalFilesystemTargetKey,
  formatTerminalFilesystemTargetKeyForPath,
  parseTerminalFilesystemTargetKey,
} from '#/shared/terminal-filesystem-target-key.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('terminal filesystem target key', () => {
  test('formats and parses Workspace/execution-root identity', () => {
    const key = formatTerminalFilesystemTargetKey(
      workspaceIdForTest('goblin+file:///repo'),
      workspaceIdForTest('goblin+file:///repo/worktree'),
    )

    expect(key).toBe('goblin+file:///repo\0goblin+file:///repo/worktree')
    expect(parseTerminalFilesystemTargetKey(key)).toEqual({
      workspaceId: 'goblin+file:///repo',
      executionRootId: 'goblin+file:///repo/worktree',
    })
  })

  test.each([
    ['goblin+file:///repo', '/repo/worktree', 'goblin+file:///repo/worktree'],
    ['goblin+ssh://dev/srv/repo', '/srv/repo/worktree', 'goblin+ssh://dev/srv/repo/worktree'],
  ])('binds a native path to the workspace transport for %s', (workspaceId, path, executionRootId) => {
    expect(formatTerminalFilesystemTargetKeyForPath(workspaceIdForTest(workspaceId), path)).toBe(
      `${workspaceId}\0${executionRootId}`,
    )
  })

  test.each([
    ['goblin+file:///repo', 'goblin+file:///repo/worktree'],
    ['goblin+ssh://dev/srv/repo', 'goblin+ssh://dev/srv/repo/worktree'],
  ])('keeps an already canonical execution-root identity idempotent for %s', (workspaceId, executionRootId) => {
    expect(formatTerminalFilesystemTargetKeyForPath(workspaceIdForTest(workspaceId), executionRootId)).toBe(
      `${workspaceId}\0${executionRootId}`,
    )
  })

  test.each([
    ['goblin+file:///repo', 'goblin+ssh://dev/srv/repo'],
    ['goblin+ssh://dev/srv/repo', 'goblin+file:///repo'],
    ['goblin+ssh://dev/srv/repo', 'goblin+ssh://other/srv/repo'],
  ])('rejects an incompatible canonical execution-root identity', (workspaceId, executionRootId) => {
    expect(() => formatTerminalFilesystemTargetKeyForPath(workspaceIdForTest(workspaceId), executionRootId)).toThrow(
      'terminal target key requires compatible canonical workspace roots',
    )
  })

  test('rejects malformed keys', () => {
    expect(parseTerminalFilesystemTargetKey('')).toBeNull()
    expect(parseTerminalFilesystemTargetKey('/repo')).toBeNull()
    expect(parseTerminalFilesystemTargetKey('/repo\0')).toBeNull()
    expect(parseTerminalFilesystemTargetKey('\0/worktree')).toBeNull()
    expect(parseTerminalFilesystemTargetKey('/repo\0/worktree\0extra')).toBeNull()
  })
})
