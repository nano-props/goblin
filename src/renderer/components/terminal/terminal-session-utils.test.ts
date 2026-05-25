import { describe, expect, test } from 'vitest'
import {
  isTerminalDescriptorLive,
  terminalDescriptor,
  terminalSessionGroupKey,
  terminalSessionKey,
} from '#/renderer/components/terminal/terminal-session-utils.ts'
import { createBranch, seedRepoState } from '#/renderer/stores/repos/test-utils.ts'
import type { ReposStore } from '#/renderer/stores/repos/types.ts'

describe('terminal session utils', () => {
  test('builds stable worktree-scoped keys', () => {
    expect(terminalSessionGroupKey('/repo', '/repo/worktree')).toBe('/repo\0/repo/worktree')
    expect(terminalSessionKey('/repo', '/repo/worktree', 'terminal-1')).toBe('/repo\0/repo/worktree\0terminal-1')
  })

  test('checks whether a terminal descriptor still has a live worktree', () => {
    const repo = seedRepoState({
      id: '/repo',
      branches: [createBranch('main', { worktreePath: '/repo' }), createBranch('feature')],
    })
    const repos: ReposStore['repos'] = { '/repo': repo }

    expect(
      isTerminalDescriptorLive(
        repos,
        terminalDescriptor({ repoRoot: '/repo', branch: 'main', worktreePath: '/repo' }, 'terminal-1', 1),
      ),
    ).toBe(true)
    expect(
      isTerminalDescriptorLive(
        repos,
        terminalDescriptor({ repoRoot: '/repo', branch: 'missing', worktreePath: '/missing' }, 'terminal-1', 1),
      ),
    ).toBe(false)
  })
})
