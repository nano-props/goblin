import { describe, expect, test } from 'vitest'
import { absoluteFilePathForTerminal, fileReadCommand } from '#/web/components/workspace-pane/file-read-command.ts'

describe('absoluteFilePathForTerminal', () => {
  test('joins POSIX worktree paths with POSIX separators', async () => {
    expect(absoluteFilePathForTerminal('/tmp/repo/', 'src/index.ts')).toBe('/tmp/repo/src/index.ts')
  })

  test('joins Windows worktree paths with Windows separators', async () => {
    expect(absoluteFilePathForTerminal('C:\\repo\\', 'src/index.ts')).toBe('C:\\repo\\src\\index.ts')
  })

  test('joins a server-resolved execution root without interpreting workspace identity', async () => {
    expect(absoluteFilePathForTerminal('/Users/example/Workspace/sample-project', 'sample-document.md')).toBe(
      '/Users/example/Workspace/sample-project/sample-document.md',
    )
  })
})

describe('fileReadCommand', () => {
  test('quotes POSIX reader paths through the user shell helper and disables bat paging with plain output', async () => {
    expect(fileReadCommand({ viewer: 'bat', shell: 'posix' }, "/tmp/repo/it's here.ts")).toBe(
      "bat --paging=never --style=plain '/tmp/repo/it'\\''s here.ts'\r",
    )
  })

  test('disables batcat paging with plain output', async () => {
    expect(fileReadCommand({ viewer: 'batcat', shell: 'posix' }, '/tmp/repo/file.ts')).toBe(
      "batcat --paging=never --style=plain '/tmp/repo/file.ts'\r",
    )
  })

  test('quotes cmd reader paths for Windows local terminals', async () => {
    expect(fileReadCommand({ viewer: 'type', shell: 'cmd' }, 'C:\\repo\\100% ready!.txt')).toBe(
      'type "C:\\repo\\100^% ready^!.txt"\r',
    )
  })
})
