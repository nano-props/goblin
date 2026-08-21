import { describe, expect, test } from 'vitest'
import { compactTerminalProcessName, compactTerminalTitle } from '#/web/terminal/components/terminal-title.ts'

describe('compactTerminalTitle', () => {
  test('prefers the trailing command segment from long terminal titles', () => {
    expect(compactTerminalTitle('~/projects/example-app — npm run dev')).toBe('example-app · npm run dev')
  })

  test('reduces host path titles to host and basename', () => {
    expect(compactTerminalTitle('prod:~/services/payments/api')).toBe('prod · api')
  })

  test('keeps useful context for host path and command titles', () => {
    expect(compactTerminalTitle('prod:~/services/payments/api — npm run dev')).toBe('prod · api · npm run dev')
  })

  test('extracts the basename from paths that contain spaces', () => {
    expect(compactTerminalTitle('~/Documents/Example Workspace')).toBe('Example Workspace')
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

  test('strips the supported Devin session prefix before compacting the title', () => {
    expect(compactTerminalTitle('devin: relevant session')).toBe('relevant session')
  })

  test('strips the supported Ubuntu VM prefix before compacting the title', () => {
    expect(compactTerminalTitle('ubuntu@VM-0-12-ubuntu: workspace')).toBe('workspace')
    expect(compactTerminalTitle('ubuntu@VM-0-12-ubuntu:~/projects/example-app')).toBe('example-app')
    expect(compactTerminalTitle('ubuntu@VM-0-12-ubuntu:~/projects/example-app — npm run dev')).toBe(
      'example-app · npm run dev',
    )
  })

  test('strips nested supported terminal wrappers', () => {
    expect(compactTerminalTitle('devin: ubuntu@VM-0-12-ubuntu:~/projects/example-app — npm run dev')).toBe(
      'example-app · npm run dev',
    )
  })

  test('keeps readable short names for ssh and command titles', () => {
    expect(compactTerminalTitle('user@prod:~/services/payments/api — npm run dev')).toBe(
      'user@prod · api · npm run dev',
    )
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
