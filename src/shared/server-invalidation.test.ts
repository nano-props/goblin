import { describe, expect, test } from 'vitest'
import { isServerInvalidationEvent, settingsInvalidationScopesForPrefsPatch } from '#/shared/server-invalidation.ts'

describe('settingsInvalidationScopesForPrefsPatch', () => {
  test('always includes the settings snapshot scope', () => {
    expect(settingsInvalidationScopesForPrefsPatch({})).toEqual(['settings-snapshot'])
  })

  test('adds only the derived scopes for changed preference groups', () => {
    expect(
      settingsInvalidationScopesForPrefsPatch({
        lang: 'ko',
        colorTheme: 'macos',
      }),
    ).toEqual(['settings-snapshot', 'i18n', 'theme'])
  })
})

describe('workspace runtime invalidation', () => {
  test('accepts canonical workspace identities and rejects native paths', () => {
    expect(
      isServerInvalidationEvent({
        type: 'workspace-runtime-invalidated',
        workspaceId: 'goblin+ssh://example/workspace',
      }),
    ).toBe(true)
    expect(isServerInvalidationEvent({ type: 'workspace-runtime-invalidated', workspaceId: '/workspace' })).toBe(false)
  })
})

describe('workspace filesystem invalidation', () => {
  test('accepts runtime-bound filesystem targets and rejects branch or native-path targets', () => {
    expect(
      isServerInvalidationEvent({
        type: 'workspace-filesystem-invalidated',
        target: {
          kind: 'git-worktree',
          workspaceId: 'goblin+file:///workspace',
          workspaceRuntimeId: 'workspace-runtime-test',
          root: 'goblin+file:///workspace-worktree',
        },
      }),
    ).toBe(true)
    expect(
      isServerInvalidationEvent({
        type: 'workspace-filesystem-invalidated',
        target: {
          kind: 'git-branch',
          workspaceId: 'goblin+file:///workspace',
          workspaceRuntimeId: 'workspace-runtime-test',
          branch: 'feature',
        },
      }),
    ).toBe(false)
    expect(
      isServerInvalidationEvent({
        type: 'workspace-filesystem-invalidated',
        target: { kind: 'workspace-root', workspaceId: '/workspace', workspaceRuntimeId: 'workspace-runtime-test' },
      }),
    ).toBe(false)
    expect(
      isServerInvalidationEvent({
        type: 'workspace-filesystem-invalidated',
        target: {
          kind: 'git-worktree',
          workspaceId: 'goblin+file:///workspace',
          workspaceRuntimeId: 'runtime with spaces',
          root: 'goblin+file:///workspace-worktree',
        },
      }),
    ).toBe(false)
    expect(
      isServerInvalidationEvent({
        type: 'workspace-filesystem-invalidated',
        target: {
          kind: 'git-worktree',
          workspaceId: 'goblin+file:///workspace',
          workspaceRuntimeId: 'workspace-runtime-test',
          root: 'goblin+ssh://example/workspace-worktree',
        },
      }),
    ).toBe(false)
  })
})
