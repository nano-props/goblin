import { describe, expect, test } from 'vitest'
import { decodeGitUpstream } from '#/system/git/upstream.ts'

const NUL = String.fromCharCode(0)

describe('decodeGitUpstream', () => {
  test('decodes a remote upstream into ancestry, source, and delete capability', () => {
    expect(
      decodeGitUpstream(['refs/remotes/origin/feature/a', 'origin', 'refs/heads/feature/a'].join(NUL)),
    ).toEqual({
      ref: 'refs/remotes/origin/feature/a',
      source: { remote: 'origin', branch: 'feature/a' },
      deleteTarget: { remote: 'origin', branch: 'feature/a' },
    })
  })

  test('keeps a local upstream for ancestry without granting remote delete capability', () => {
    expect(decodeGitUpstream(['refs/heads/main', '.', 'refs/heads/main'].join(NUL))).toEqual({
      ref: 'refs/heads/main',
      source: { remote: '.', branch: 'main' },
      deleteTarget: null,
    })
  })

  test.each(['team/backend', 'fork+mirror', 'release@host', 'rémote'])('accepts legal remote name %s', (remote) => {
    expect(
      decodeGitUpstream([`refs/remotes/${remote}/main`, remote, 'refs/heads/main'].join(NUL))?.source.remote,
    ).toBe(remote)
  })

  test('distinguishes no upstream from missing or malformed protocol output', () => {
    expect(decodeGitUpstream(NUL + NUL)).toBeNull()
    expect(() => decodeGitUpstream('')).toThrow('Git returned an invalid upstream')
    expect(() => decodeGitUpstream(['refs/remotes/origin/main', 'origin'].join(NUL))).toThrow(
      'Git returned an invalid upstream',
    )
    expect(() => decodeGitUpstream(['refs/remotes/origin/main', 'origin', 'refs/heads/main', 'extra'].join(NUL))).toThrow(
      'Git returned an invalid upstream',
    )
  })
})
