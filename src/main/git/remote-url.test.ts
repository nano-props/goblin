import { describe, expect, test } from 'vitest'
import { isGitHubHost, isGitLabHost, parseGitRemoteUrl, remoteUrlToHttps } from '#/main/git/remote-url.ts'

describe('parseGitRemoteUrl', () => {
  test('parses https, ssh, and scp-like remote URLs', () => {
    expect(parseGitRemoteUrl('https://github.com/acme/repo.git')).toEqual({
      host: 'github.com',
      path: 'acme/repo',
    })
    expect(parseGitRemoteUrl('ssh://git@gitlab.example.com:2222/acme/platform/repo.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'acme/platform/repo',
    })
    expect(parseGitRemoteUrl('git@github.com:acme/repo.git')).toEqual({
      host: 'github.com',
      path: 'acme/repo',
    })
  })

  test('normalizes browser URLs from supported remote URL forms', () => {
    expect(remoteUrlToHttps('git@gitlab.com:acme/platform/repo.git')).toBe('https://gitlab.com/acme/platform/repo')
    expect(remoteUrlToHttps('ssh://git@github.example.com/acme/repo.git')).toBe(
      'https://github.example.com/acme/repo',
    )
  })

  test('rejects malformed and local remotes', () => {
    expect(parseGitRemoteUrl('/tmp/repo.git')).toBeNull()
    expect(parseGitRemoteUrl('https://bad host/acme/repo.git')).toBeNull()
    expect(parseGitRemoteUrl('git@github.com: acme/repo.git')).toBeNull()
    expect(parseGitRemoteUrl('not-a-remote')).toBeNull()
  })
})

describe('remote host providers', () => {
  test('detects GitHub and GitHub Enterprise hosts', () => {
    expect(isGitHubHost('github.com')).toBe(true)
    expect(isGitHubHost('github.example.com')).toBe(true)
    expect(isGitHubHost('code.github.example.com')).toBe(true)
    expect(isGitHubHost('acme.ghe.com')).toBe(true)
    expect(isGitHubHost('gitlab.com')).toBe(false)
  })

  test('detects GitLab and self-hosted GitLab hosts', () => {
    expect(isGitLabHost('gitlab.com')).toBe(true)
    expect(isGitLabHost('gitlab.example.com')).toBe(true)
    expect(isGitLabHost('code.gitlab.example.com')).toBe(true)
    expect(isGitLabHost('code.example.com')).toBe(false)
  })
})
