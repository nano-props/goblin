import { describe, expect, test } from 'vitest'
import { compactTerminalTitle } from '#/web/components/terminal/terminal-session-utils.ts'

describe('compactTerminalTitle', () => {
  test('prefers the trailing command segment from long terminal titles', () => {
    expect(compactTerminalTitle('~/Developer/goblin — npm run dev')).toBe('goblin · npm run dev')
  })

  test('reduces host path titles to host and basename', () => {
    expect(compactTerminalTitle('prod:~/services/payments/api')).toBe('prod · api')
  })

  test('keeps useful context for host path and command titles', () => {
    expect(compactTerminalTitle('prod:~/services/payments/api — npm run dev')).toBe('prod · api · npm run dev')
  })

  test('extracts the basename from paths that contain spaces', () => {
    expect(compactTerminalTitle('~/Library/Application Support/Goblin')).toBe('Goblin')
  })

  test('shortens long commands even when they only contain one or two tokens', () => {
    expect(compactTerminalTitle('super-long-dev-server-command-name-that-keeps-going')).toBe(
      'super-long-dev-server-command-n…',
    )
    expect(compactTerminalTitle('python /very/long/path/to/script.py')).toBe('python script.py')
  })

  test('does not mistake urls for host path titles', () => {
    expect(compactTerminalTitle('https://example.com/very/long/path/to/page')).toBe('page')
  })

  test('strips leading labels like devin before compacting the real title', () => {
    expect(compactTerminalTitle('devin: some real info')).toBe('some real info')
  })
})
