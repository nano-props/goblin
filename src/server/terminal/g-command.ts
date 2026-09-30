import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GOBLIN_TERMINAL_SESSION_ID_ENV } from '#/shared/g-command.ts'
import { shellQuote } from '#/system/remote-shell.ts'

export interface GoblinTerminalCommandRuntime {
  serverUrl: string
  accessToken: string
  binDir: string
}

export interface GoblinTerminalCommandEnvironmentInput extends GoblinTerminalCommandRuntime {
  terminalSessionId: string
  currentPath?: string
}

/** The launcher is private to one server lifetime and contains no credentials. */
export function createGoblinCommandLauncher(command: readonly string[]): { binDir: string; dispose(): void } {
  if (command.length === 0) throw new Error('Goblin executable command is required')
  const directory = mkdtempSync(path.join(os.tmpdir(), 'goblin-command-'))
  const binDir = path.join(directory, 'bin')
  try {
    mkdirSync(binDir, { mode: 0o700 })
    writeFileSync(path.join(binDir, 'g'), `#!/bin/sh\nexec ${command.map(shellQuote).join(' ')} g "$@"\n`, {
      mode: 0o700,
    })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return { binDir, dispose: () => rmSync(directory, { recursive: true, force: true }) }
}

export function buildGoblinTerminalCommandEnvironment(
  input: GoblinTerminalCommandEnvironmentInput,
): Record<string, string> | null {
  if (!existsSync(path.join(input.binDir, 'g'))) return null
  const currentPath = input.currentPath ?? process.env.PATH ?? ''
  return {
    PATH: currentPath.split(path.delimiter).includes(input.binDir)
      ? currentPath
      : [input.binDir, currentPath].filter(Boolean).join(path.delimiter),
    GOBLIN_TERMINAL: '1',
    [GOBLIN_TERMINAL_SESSION_ID_ENV]: input.terminalSessionId,
    GOBLIN_SERVER_URL: input.serverUrl,
    GOBLIN_SERVER_ACCESS_TOKEN: input.accessToken,
  }
}
