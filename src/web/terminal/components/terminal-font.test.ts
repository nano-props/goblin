// @vitest-environment jsdom

import { expect, test } from 'vitest'
import { preloadTerminalFont } from '#/web/terminal/components/terminal-font.ts'

test('font preload resolves when the browser FontFaceSet is unavailable', async () => {
  await expect(preloadTerminalFont()).resolves.toBeUndefined()
})
