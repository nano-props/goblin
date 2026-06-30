import { describe, expect, test } from 'vitest'
import { absoluteFilePathForTerminal, fileReadCommand } from '#/web/components/repo-workspace/file-read-command.ts'

describe('absoluteFilePathForTerminal', () => {
  test('joins POSIX worktree paths with POSIX separators', () => {
    expect(absoluteFilePathForTerminal('/tmp/repo/', 'src/index.ts')).toBe('/tmp/repo/src/index.ts')
  })

  test('joins Windows worktree paths with Windows separators', () => {
    expect(absoluteFilePathForTerminal('C:\\repo\\', 'src/index.ts')).toBe('C:\\repo\\src\\index.ts')
  })
})

describe('fileReadCommand', () => {
  test('quotes POSIX reader paths through the user shell helper and disables bat paging', () => {
    expect(fileReadCommand({ viewer: 'bat', shell: 'posix' }, "/tmp/repo/it's here.ts")).toBe(
      "bat --paging=never '/tmp/repo/it'\\''s here.ts'\r",
    )
  })

  test('disables batcat paging', () => {
    expect(fileReadCommand({ viewer: 'batcat', shell: 'posix' }, '/tmp/repo/file.ts')).toBe(
      "batcat --paging=never '/tmp/repo/file.ts'\r",
    )
  })

  test('quotes cmd reader paths for Windows local terminals', () => {
    expect(fileReadCommand({ viewer: 'type', shell: 'cmd' }, 'C:\\repo\\100% ready!.txt')).toBe(
      'type "C:\\repo\\100^% ready^!.txt"\r',
    )
  })
})
