import stringWidth from 'string-width'
import { expect, test, vi } from 'vitest'
import { formatUsage } from '#/server/g-command/registry.ts'

test('aligns help summaries by terminal display width', () => {
  const run = vi.fn(async () => 0)
  const output = formatUsage([
    { name: 'feature', usage: 'g 功能', summary: 'Chinese usage', run },
    { name: 'feature-long', usage: 'g feature', summary: 'ASCII usage', run },
  ])
  const lines = output.split('\n')
  const chineseLine = lines.find((line) => line.includes('Chinese usage')) ?? ''
  const asciiLine = lines.find((line) => line.includes('ASCII usage')) ?? ''

  expect(stringWidth(chineseLine.slice(0, chineseLine.indexOf('Chinese usage')))).toBe(
    stringWidth(asciiLine.slice(0, asciiLine.indexOf('ASCII usage'))),
  )
})
