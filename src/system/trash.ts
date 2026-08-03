import { execa } from 'execa'
import type { TrashCommandOutcome } from '#/system/trash-command-outcome.ts'

interface TrashCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

export async function movePathToTrash(path: string, signal?: AbortSignal): Promise<TrashCommandOutcome> {
  if (signal?.aborted) {
    return { result: { ok: false, message: 'cancelled' }, execution: { status: 'not-started' } }
  }

  const commands = trashCommandsForPlatform(path)
  let sawExecutable = false
  let lastMessage = 'error.failed-trash-file'

  for (const command of commands) {
    try {
      await execa(command.command, command.args, {
        reject: true,
        cancelSignal: signal,
      })
      return { result: { ok: true, message: 'ok' }, execution: { status: 'succeeded' } }
    } catch (err) {
      if (isCommandMissing(err)) continue
      sawExecutable = true
      if (signal?.aborted) {
        return { result: { ok: false, message: 'cancelled' }, execution: { status: 'cancelled' } }
      }
      lastMessage = errorMessageFromUnknown(err) || lastMessage
    }
  }

  return sawExecutable
    ? { result: { ok: false, message: lastMessage }, execution: { status: 'failed' } }
    : { result: { ok: false, message: 'error.trash-unavailable' }, execution: { status: 'not-started' } }
}

function trashCommandsForPlatform(path: string): ReadonlyArray<TrashCommand> {
  if (process.platform === 'darwin') {
    return [
      {
        command: 'osascript',
        args: ['-e', `tell application "Finder" to delete POSIX file ${JSON.stringify(path)}`],
      },
    ]
  }

  if (process.platform === 'win32') {
    return [
      {
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          [
            '$p=$args[0]',
            'Add-Type -AssemblyName Microsoft.VisualBasic',
            '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)',
          ].join('; '),
          path,
        ],
      },
    ]
  }

  return [
    { command: 'gio', args: ['trash', '--', path] },
    { command: 'trash-put', args: ['--', path] },
    { command: 'kioclient6', args: ['move', path, 'trash:/'] },
    { command: 'kioclient5', args: ['move', path, 'trash:/'] },
  ]
}

function isCommandMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

function errorMessageFromUnknown(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null
  const maybe = err as { stderr?: unknown; message?: unknown }
  if (typeof maybe.stderr === 'string' && maybe.stderr.trim()) return maybe.stderr.trim()
  if (typeof maybe.message === 'string' && maybe.message.trim()) return maybe.message.trim()
  return null
}
