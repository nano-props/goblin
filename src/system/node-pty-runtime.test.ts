import { describe, expect, test, vi } from 'vitest'
import { prepareNodePtyDarwinRuntime, validateNodePtyDarwinRuntime } from '#/system/node-pty-runtime.ts'

describe('prepareNodePtyDarwinRuntime', () => {
  test('repairs a non-executable helper when the caller owns deployment preparation', () => {
    const chmod = vi.fn()
    prepareNodePtyDarwinRuntime({
      packageRoot: '/runtime/node_modules/node-pty',
      platform: 'darwin',
      arch: 'arm64',
      stat: vi.fn(() => ({ mode: 0o644 })) as never,
      chmod: chmod as never,
    })
    expect(chmod).toHaveBeenCalledWith('/runtime/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper', 0o755)
  })

  test('fails validation instead of modifying a packaged runtime', () => {
    expect(() =>
      validateNodePtyDarwinRuntime({
        packageRoot: '/runtime/node_modules/node-pty',
        platform: 'darwin',
        arch: 'arm64',
        stat: vi.fn(() => ({ mode: 0o644 })) as never,
      }),
    ).toThrow('node-pty spawn-helper is not executable')
  })

  test('leaves an executable helper unchanged', () => {
    const chmod = vi.fn()
    prepareNodePtyDarwinRuntime({
      packageRoot: '/runtime/node_modules/node-pty',
      platform: 'darwin',
      stat: vi.fn(() => ({ mode: 0o755 })) as never,
      chmod: chmod as never,
    })
    expect(chmod).not.toHaveBeenCalled()
  })

  test('does nothing off macOS', () => {
    const stat = vi.fn()
    prepareNodePtyDarwinRuntime({
      packageRoot: '/runtime/node_modules/node-pty',
      platform: 'linux',
      stat: stat as never,
    })
    expect(stat).not.toHaveBeenCalled()
  })

  test('fails fast when the helper is missing', () => {
    expect(() =>
      validateNodePtyDarwinRuntime({
        packageRoot: '/runtime/node_modules/node-pty',
        platform: 'darwin',
        stat: vi.fn(() => {
          throw new Error('ENOENT')
        }) as never,
      }),
    ).toThrow('ENOENT')
  })
})
