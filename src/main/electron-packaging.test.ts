import { describe, expect, test } from 'vitest'
import { ELECTRON_SERVER_EXTRA_RESOURCES } from '#scripts/electron-packaging.ts'

describe('Electron packaged server layout', () => {
  test('deploys the complete ASAR-unaware server runtime as ordinary resources', () => {
    expect(ELECTRON_SERVER_EXTRA_RESOURCES).toEqual([
      { from: 'dist/server', to: 'dist/server' },
      { from: 'dist/web', to: 'dist/web' },
      { from: 'node_modules/node-pty', to: 'node_modules/node-pty' },
    ])
  })
})
