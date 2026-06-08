import { describe, expect, test } from 'vitest'
import { buildRemoteTerminalInvocation } from '#/system/remote-terminal.ts'

describe('buildRemoteTerminalInvocation', () => {
  test('builds a safe ssh invocation for an absolute remote worktree path', () => {
    const invocation = buildRemoteTerminalInvocation('prod', '/srv/repo-feature')

    expect(invocation).not.toBeNull()
    expect(invocation?.command).toBe('ssh')
    expect(invocation?.args).toEqual([
      '-tt',
      '--',
      'prod',
      `sh -lc 'cd '\\''/srv/repo-feature'\\'' && exec "\${SHELL:-/bin/sh}" -l'`,
    ])
    expect(invocation?.shellCommand).toContain('ssh')
    expect(invocation?.shellCommand).toContain('prod')
    expect(invocation?.shellCommand).toContain('/srv/repo-feature')
  })

  test('shell-quotes remote paths that contain single quotes', () => {
    const invocation = buildRemoteTerminalInvocation('prod', "/srv/repo's-feature")

    expect(invocation).not.toBeNull()
    expect(invocation?.args[3]).toBe(
      `sh -lc 'cd '\\''/srv/repo'\\''\\'\\'''\\''s-feature'\\'' && exec "\${SHELL:-/bin/sh}" -l'`,
    )
  })

  test('rejects unsafe aliases and remote paths', () => {
    expect(buildRemoteTerminalInvocation('bad alias', '/srv/repo')).toBeNull()
    expect(buildRemoteTerminalInvocation('prod', 'relative/repo')).toBeNull()
    expect(buildRemoteTerminalInvocation('prod', '/srv/\u0000repo')).toBeNull()
    expect(buildRemoteTerminalInvocation('prod', '')).toBeNull()
  })
})
