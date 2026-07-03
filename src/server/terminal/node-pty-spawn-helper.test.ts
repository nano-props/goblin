import { describe, expect, test, vi } from 'vitest'
import { ensureNodePtyDarwinSpawnHelperExecutableWithOptions } from '#/server/terminal/node-pty-spawn-helper.ts'

describe('ensureNodePtyDarwinSpawnHelperExecutableWithOptions', () => {
  test('chmods the darwin spawn-helper when executable bits are missing', () => {
    const chmod = vi.fn()
    const stat = vi.fn(() => ({ mode: 0o666 }))

    ensureNodePtyDarwinSpawnHelperExecutableWithOptions({
      platform: 'darwin',
      arch: 'arm64',
      resolveNodePtyEntry: () => '/repo/node_modules/node-pty/lib/index.js',
      stat: stat as never,
      chmod: chmod as never,
    })

    expect(stat).toHaveBeenCalledWith('/repo/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper')
    expect(chmod).toHaveBeenCalledWith('/repo/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper', 0o755)
  })

  test('leaves already-executable helpers alone', () => {
    const chmod = vi.fn()

    ensureNodePtyDarwinSpawnHelperExecutableWithOptions({
      platform: 'darwin',
      arch: 'x64',
      resolveNodePtyEntry: () => '/repo/node_modules/node-pty/lib/index.js',
      stat: vi.fn(() => ({ mode: 0o755 })) as never,
      chmod: chmod as never,
    })

    expect(chmod).not.toHaveBeenCalled()
  })

  test('does nothing off macOS', () => {
    const stat = vi.fn()
    const chmod = vi.fn()

    ensureNodePtyDarwinSpawnHelperExecutableWithOptions({
      platform: 'linux',
      arch: 'arm64',
      resolveNodePtyEntry: () => '/repo/node_modules/node-pty/lib/index.js',
      stat: stat as never,
      chmod: chmod as never,
    })

    expect(stat).not.toHaveBeenCalled()
    expect(chmod).not.toHaveBeenCalled()
  })
})
