import { existsSync } from 'node:fs'
import path from 'node:path'

export interface GoblinTerminalCommandRuntime {
  serverUrl: string
  accessToken: string
  entryPath: string
  binDir?: string
  nodePath?: string
}

export interface GoblinTerminalCommandEnvironmentInput extends GoblinTerminalCommandRuntime {
  currentPath?: string
  fileExists?: typeof existsSync
}

export function buildGoblinTerminalCommandEnvironment(
  input: GoblinTerminalCommandEnvironmentInput,
): Record<string, string> | null {
  const fileExists = input.fileExists ?? existsSync
  const binDir = input.binDir ?? resolveGoblinCommandBinDir(fileExists)
  if (!binDir || !fileExists(path.join(binDir, process.platform === 'win32' ? 'g.cmd' : 'g'))) return null
  if (!fileExists(input.entryPath)) return null
  return {
    PATH: prependPath(binDir, input.currentPath ?? process.env.PATH ?? ''),
    GOBLIN_TERMINAL: '1',
    GOBLIN_SERVER_URL: input.serverUrl,
    GOBLIN_SERVER_ACCESS_TOKEN: input.accessToken,
    GOBLIN_NODE: input.nodePath ?? process.execPath,
    GOBLIN_CLI_ENTRY: input.entryPath,
  }
}

export function resolveGoblinCommandEntry(dirname: string, fileExists: typeof existsSync = existsSync): string {
  const built = path.resolve(dirname, 'g-command.js')
  if (fileExists(built)) return built
  const source = path.resolve(dirname, 'g-command.ts')
  if (fileExists(source)) return source
  throw new Error(`Goblin command entry not found in ${dirname}`)
}

function resolveGoblinCommandBinDir(fileExists: typeof existsSync): string | null {
  const explicit = process.env.GOBLIN_COMMAND_BIN_DIR?.trim()
  if (explicit && fileExists(explicit)) return explicit

  const packaged = path.join(process.cwd(), 'terminal-bin')
  if (fileExists(packaged)) return packaged

  const source = path.join(process.cwd(), 'resources', 'terminal-bin')
  if (fileExists(source)) return source

  return null
}

function prependPath(directory: string, currentPath: string): string {
  const parts = currentPath.split(path.delimiter).filter(Boolean)
  if (parts.includes(directory)) return currentPath || directory
  return currentPath ? `${directory}${path.delimiter}${currentPath}` : directory
}
