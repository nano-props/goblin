import { shell } from 'electron'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openHttpExternal, openHttpsExternal } from '#/main/external-url.ts'

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
}))

describe('external URL opening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(shell.openExternal).mockResolvedValue(undefined)
  })

  test('opens https URLs through the https-only helper', async () => {
    await expect(openHttpsExternal('https://example.com/path')).resolves.toBe(true)
    await expect(openHttpsExternal('http://example.com/path')).resolves.toBe(false)

    expect(shell.openExternal).toHaveBeenCalledTimes(1)
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/path')
  })

  test('rejects unsafe URLs through the https-only helper', async () => {
    await expect(openHttpsExternal('javascript:alert(1)')).resolves.toBe(false)
    await expect(openHttpsExternal('file:///tmp/secret')).resolves.toBe(false)
    await expect(openHttpsExternal('https://example.com/\u0000bad')).resolves.toBe(false)
    await expect(openHttpsExternal('not a url')).resolves.toBe(false)
    await expect(openHttpsExternal(`https://example.com/${'a'.repeat(4096)}`)).resolves.toBe(false)

    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  test('opens http and https URLs externally', async () => {
    await expect(openHttpExternal('https://example.com/path')).resolves.toBe(true)
    await expect(openHttpExternal('http://localhost:3000')).resolves.toBe(true)

    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/path')
    expect(shell.openExternal).toHaveBeenCalledWith('http://localhost:3000/')
  })

  test('rejects non-web, malformed, control-character, and overlong URLs', async () => {
    await expect(openHttpExternal('javascript:alert(1)')).resolves.toBe(false)
    await expect(openHttpExternal('file:///tmp/secret')).resolves.toBe(false)
    await expect(openHttpExternal('https://example.com/\u0000bad')).resolves.toBe(false)
    await expect(openHttpExternal('not a url')).resolves.toBe(false)
    await expect(openHttpExternal(`https://example.com/${'a'.repeat(4096)}`)).resolves.toBe(false)

    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})
