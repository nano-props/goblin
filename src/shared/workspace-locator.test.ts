import { describe, expect, it } from 'vitest'
import {
  canonicalWorkspaceLocator,
  formatWorkspaceLocator,
  parseWorkspaceLocator,
  toSafeCanonicalWorkspaceId,
  workspaceLocatorForPath,
} from '#/shared/workspace-locator.ts'

describe('toSafeCanonicalWorkspaceId', () => {
  it.each(['goblin+file:///workspace', 'goblin+ssh://host/workspace'])('preserves canonical locator %s', (locator) =>
    expect(toSafeCanonicalWorkspaceId(locator)).toBe(locator),
  )

  it.each(['', '/workspace', 'C:\\workspace', 'C:/workspace', '\\\\server\\workspace', 'relative/workspace', 'workspace\0suffix'] as const)(
    'rejects invalid locator %s',
    (locator) => {
      expect(toSafeCanonicalWorkspaceId(locator)).toBeNull()
    },
  )

  it('rejects canonical-looking locators beyond the wire identity limit', () => {
    expect(toSafeCanonicalWorkspaceId(`goblin+file:///${'a'.repeat(4096)}`)).toBeNull()
  })
})

describe('workspace locator codec', () => {
  it.each([
    ['goblin+file:///', 'posix', { transport: 'file', platform: 'posix', path: '/' }],
    [
      'goblin+file:///Users/example/project%20one/%25name',
      'posix',
      { transport: 'file', platform: 'posix', path: '/Users/example/project one/%name' },
    ],
    ['goblin+file:///C:/code/project', 'win32', { transport: 'file', platform: 'win32', path: 'C:\\code\\project' }],
    ['goblin+file:///C:/', 'win32', { transport: 'file', platform: 'win32', path: 'C:\\' }],
    ['goblin+ssh://my-server/srv/app', 'posix', { transport: 'ssh', profile: 'my-server', path: '/srv/app' }],
    ['goblin+ssh://My-Server/', 'win32', { transport: 'ssh', profile: 'My-Server', path: '/' }],
  ] as const)('round trips %s', (input, platform, parsed) => {
    expect(parseWorkspaceLocator(input, platform)).toEqual(parsed)
    expect(formatWorkspaceLocator(parsed, platform)).toBe(input)
  })

  it('preserves canonically distinct NFC and NFD paths', () => {
    const nfc = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/caf\u00e9' }, 'posix')
    const nfd = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/cafe\u0301' }, 'posix')
    expect(nfc).toBe('goblin+file:///caf%C3%A9')
    expect(nfd).toBe('goblin+file:///cafe%CC%81')
    expect(nfc).not.toBe(nfd)
  })

  it.each([
    ['goblin+file:///repo', '/repo/worktree', 'goblin+file:///repo/worktree'],
    ['goblin+ssh://dev/srv/repo', '/srv/repo/worktree', 'goblin+ssh://dev/srv/repo/worktree'],
  ])('binds %s transport identity to an authoritative path', (workspace, path, expected) => {
    const workspaceId = canonicalWorkspaceLocator(workspace)
    expect(workspaceId).not.toBeNull()
    expect(workspaceId && workspaceLocatorForPath(workspaceId, path)).toBe(expected)
  })

  it.each([
    'goblin+file:///tmp/a%2fb',
    'goblin+file:///tmp/a%2Fb',
    'goblin+file:///tmp/a%5Cb',
    'goblin+file:///tmp/%2E',
    'goblin+file:///tmp/.',
    'goblin+file:///tmp/..',
    'goblin+file:///tmp//child',
    'goblin+file:///tmp/child/',
    'goblin+file:///tmp/a b',
    'goblin+file:///tmp/%41',
    'goblin+file:///tmp/%',
    'goblin+file:///tmp/%FF',
    'goblin+file://host/tmp',
    'goblin+file:///C:/code',
    'goblin+file:///tmp?query',
    'goblin+file:///tmp#fragment',
    'file:///tmp',
    '/tmp',
    'ssh-config://host/tmp',
  ])('rejects non-canonical or unsupported POSIX locator %s', (input) => {
    expect(parseWorkspaceLocator(input, 'posix')).toBeNull()
  })

  it.each([
    'goblin+file:///c:/code',
    'goblin+file:///tmp/project',
    'goblin+file:///C:/code/',
    'goblin+file://host/C:/code',
  ])('rejects non-canonical or wrong-platform Windows locator %s', (input) => {
    expect(parseWorkspaceLocator(input, 'win32')).toBeNull()
  })

  it.each([
    'goblin+ssh://-F/srv/app',
    'goblin+ssh://./srv/app',
    'goblin+ssh://../srv/app',
    'goblin+ssh://user@host/srv/app',
    'goblin+ssh://host:22/srv/app',
    'goblin+ssh://host*/srv/app',
    'goblin+ssh://h%C3%B6st/srv/app',
    'goblin+ssh://host/srv/%2Fetc',
    'goblin+ssh://host/srv/%252Fetc/',
  ])('rejects invalid SSH locator %s', (input) => {
    expect(parseWorkspaceLocator(input, 'posix')).toBeNull()
  })

  it('decodes a percent escape exactly once', () => {
    expect(parseWorkspaceLocator('goblin+ssh://host/srv/%252Fetc', 'posix')).toEqual({
      transport: 'ssh',
      profile: 'host',
      path: '/srv/%2Fetc',
    })
  })

  it.each([
    [{ transport: 'file', platform: 'posix', path: 'relative' }, 'posix'],
    [{ transport: 'file', platform: 'posix', path: '/C:/code' }, 'posix'],
    [{ transport: 'file', platform: 'posix', path: '/tmp/' }, 'posix'],
    [{ transport: 'file', platform: 'posix', path: '/tmp/../etc' }, 'posix'],
    [{ transport: 'file', platform: 'win32', path: 'c:\\code' }, 'win32'],
    [{ transport: 'file', platform: 'win32', path: 'C:\\code' }, 'posix'],
    [{ transport: 'ssh', profile: '-host', path: '/srv/app' }, 'posix'],
    [{ transport: 'ssh', profile: 'host', path: 'srv/app' }, 'posix'],
  ] as const)('formatter returns null without repairing invalid input', (locator, platform) => {
    expect(formatWorkspaceLocator(locator, platform)).toBeNull()
  })

  it('never throws or replaces malformed runtime input', () => {
    expect(formatWorkspaceLocator(null as never, 'posix')).toBeNull()
    expect(formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: 42 } as never, 'posix')).toBeNull()
    expect(
      formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/bad\uD800value' }, 'posix'),
    ).toBeNull()
  })
})
