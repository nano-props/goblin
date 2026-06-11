import { describe, expect, test } from 'vitest'
import { compactTerminalProcessName, compactTerminalTitle } from '#/web/components/terminal/terminal-title.ts'

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

  test('strips ubuntu@VM host prefix before compacting the real title', () => {
    expect(compactTerminalTitle('ubuntu@VM-0-12-ubuntu: dirname-a')).toBe('dirname-a')
    expect(compactTerminalTitle('ubuntu@VM-0-12-ubuntu:~/projects/goblin')).toBe('goblin')
    expect(compactTerminalTitle('ubuntu@VM-0-12-ubuntu:~/projects/goblin — npm run dev')).toBe('goblin · npm run dev')
  })

  test('handles nested terminal title wrappers from real remote sessions', () => {
    expect(compactTerminalTitle('devin: ubuntu@VM-0-12-ubuntu:~/projects/goblin — npm run dev')).toBe(
      'goblin · npm run dev',
    )
    expect(compactTerminalTitle('devin: user@prod:~/services/payments/api')).toBe('user@prod · api')
  })

  test('keeps readable short names for real ssh and command titles', () => {
    expect(compactTerminalTitle('user@prod:~/services/payments/api — npm run dev')).toBe('user@prod · api · npm run dev')
    expect(compactTerminalTitle('~/src/project-name — python manage.py shell')).toBe('project-name · python manage.py…')
  })
})

describe('compactTerminalProcessName', () => {
  test('compacts shell executable paths to their basename', () => {
    expect(compactTerminalProcessName('/bin/bash')).toBe('bash')
    expect(compactTerminalProcessName('/bin/zsh')).toBe('zsh')
    expect(compactTerminalProcessName('/usr/bin/fish')).toBe('fish')
  })

  test('keeps plain process names unchanged', () => {
    expect(compactTerminalProcessName('bash')).toBe('bash')
    expect(compactTerminalProcessName('node')).toBe('node')
  })
})
