import { describe, expect, test } from 'vitest'
import {
  deriveLocalBranchFromRemoteRef,
  normalizeCreateWorktreeInput,
  parseRemoteTrackingRefs,
} from '#/shared/worktree-create.ts'

describe('worktree create helpers', () => {
  test('accepts a new branch create request', () => {
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      }),
    ).toEqual({
      worktreePath: '/tmp/repo-feature',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })
  })

  test('accepts existing branch and trackRemoteBranch requests', () => {
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo-existing',
        mode: { kind: 'existingBranch', branch: 'feature/existing' },
      }),
    ).toMatchObject({ mode: { kind: 'existingBranch', branch: 'feature/existing' } })

    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo-track',
        mode: {
          kind: 'trackRemoteBranch',
          remote: { ref: 'refs/remotes/origin/feature/a', remote: 'origin', branch: 'feature/a' },
          localBranch: 'feature/a',
        },
      }),
    ).toMatchObject({
      mode: {
        kind: 'trackRemoteBranch',
        remote: { ref: 'refs/remotes/origin/feature/a', remote: 'origin', branch: 'feature/a' },
        localBranch: 'feature/a',
      },
    })
  })

  test('rejects malformed requests', () => {
    expect(
      normalizeCreateWorktreeInput({ worktreePath: '', mode: { kind: 'existingBranch', branch: 'main' } }),
    ).toBeNull()
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo',
        mode: {
          kind: 'trackRemoteBranch',
          remote: { ref: 'refs/remotes/origin/feature/a', remote: 'origin', branch: 'feature/a' },
          localBranch: 'bad branch',
        },
      }),
    ).toBeNull()
    expect(normalizeCreateWorktreeInput({ worktreePath: '/tmp/repo', mode: { kind: 'unknown' } })).toBeNull()
    expect(
      normalizeCreateWorktreeInput({ worktreePath: '/tmp/repo', mode: { kind: 'detached', ref: 'main' } }),
    ).toBeNull()
  })

  test('parses and filters remote-tracking refs', () => {
    expect(parseRemoteTrackingRefs(
      'refs/remotes/origin/HEAD\nrefs/remotes/origin/main\nrefs/remotes/origin/feature/a\nrefs/remotes/upstream/release/v1\n',
      [
        { name: 'origin', fetchSpecs: ['+refs/heads/*:refs/remotes/origin/*'] },
        { name: 'upstream', fetchSpecs: ['+refs/heads/*:refs/remotes/upstream/*'] },
      ],
    )).toEqual([
      { ref: 'refs/remotes/origin/main', remote: 'origin', branch: 'main' },
      { ref: 'refs/remotes/origin/feature/a', remote: 'origin', branch: 'feature/a' },
      { ref: 'refs/remotes/upstream/release/v1', remote: 'upstream', branch: 'release/v1' },
    ])
  })

  test('derives local branch names from remote refs', () => {
    expect(deriveLocalBranchFromRemoteRef({ ref: 'refs/remotes/team/backend/feature/a', remote: 'team/backend', branch: 'feature/a' })).toBe('feature/a')
  })

  test('rejects a ref owned by multiple authoritative fetch mappings', () => {
    expect(() => parseRemoteTrackingRefs('refs/remotes/team/backend/main\n', [
      { name: 'team', fetchSpecs: ['+refs/heads/*:refs/remotes/team/*'] },
      { name: 'team/backend', fetchSpecs: ['+refs/heads/*:refs/remotes/team/backend/*'] },
    ])).toThrow('Ambiguous remote-tracking ref ownership')
  })

  test('applies wildcard and exact negative fetch refspecs to source refs', () => {
    expect(parseRemoteTrackingRefs('refs/remotes/origin/main\n', [{
      name: 'origin',
      fetchSpecs: [
        '+refs/heads/*:refs/remotes/origin/*',
        '^refs/heads/archive/*',
        '^refs/heads/private',
      ],
    }])).toEqual([{ ref: 'refs/remotes/origin/main', remote: 'origin', branch: 'main' }])
    expect(parseRemoteTrackingRefs(
      'refs/remotes/origin/main\nrefs/remotes/origin/archive/old\nrefs/remotes/origin/private\n',
      [{
      name: 'origin',
      fetchSpecs: [
        '+refs/heads/*:refs/remotes/origin/*',
        '^refs/heads/archive/*',
        '^refs/heads/private',
      ],
    }])).toEqual([{ ref: 'refs/remotes/origin/main', remote: 'origin', branch: 'main' }])
  })

  test('ignores valid fetch refspecs that do not produce remote branch ownership', () => {
    expect(parseRemoteTrackingRefs('refs/remotes/origin/main\n', [{
      name: 'origin',
      fetchSpecs: [
        '+refs/heads/*:refs/remotes/origin/*',
        '+refs/pull/*/head:refs/remotes/origin-pr/*',
        'refs/notes/*:refs/notes/*',
        'refs/tags/release',
      ],
    }])).toEqual([{ ref: 'refs/remotes/origin/main', remote: 'origin', branch: 'main' }])
  })

  test.each([
    '+refs/pull/**/head:refs/remotes/origin-pr/*',
    'refs/notes/*:refs/notes/**',
    'refs/tags/..',
  ])('rejects malformed positive refspecs even when they do not produce remote branches: %s', (spec) => {
    expect(() => parseRemoteTrackingRefs('refs/remotes/origin/main\n', [{
      name: 'origin',
      fetchSpecs: ['+refs/heads/*:refs/remotes/origin/*', spec],
    }])).toThrow('Invalid remote fetch refspec')
  })

  test.each(['+^refs/heads/archive/*', '^refs/heads/archive/*:refs/remotes/origin/*', '^other/**', '^refs/heads/**'])(
    'rejects malformed negative fetch refspec %s',
    (spec) => {
      expect(() => parseRemoteTrackingRefs('refs/remotes/origin/main\n', [{
        name: 'origin',
        fetchSpecs: ['+refs/heads/*:refs/remotes/origin/*', spec],
      }])).toThrow('Invalid negative remote fetch refspec')
    },
  )
})
