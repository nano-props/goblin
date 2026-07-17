import { describe, expect, test } from 'vitest'
import { ELECTRON_ASAR_UNPACK_PATTERNS } from '#scripts/electron-packaging.ts'

describe('Electron packaged server layout', () => {
  test('keeps the complete ASAR-unaware server runtime on the native filesystem', () => {
    expect(ELECTRON_ASAR_UNPACK_PATTERNS).toEqual(['dist/server/**/*', 'dist/web/**/*', 'node_modules/node-pty/**/*'])
  })
})
