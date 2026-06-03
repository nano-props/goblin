import { accessSync, constants, existsSync, statSync } from 'node:fs'
import path from 'node:path'

function candidateDirectories(extraDirectories: string[]): string[] {
  const seen = new Set<string>()
  const values = [...(process.env.PATH?.split(path.delimiter) ?? []), ...extraDirectories]
  const directories: string[] = []
  for (const value of values) {
    const directory = value.trim()
    if (!directory || seen.has(directory)) continue
    seen.add(directory)
    directories.push(directory)
  }
  return directories
}

function isExecutableFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false
  try {
    if (!statSync(filePath).isFile()) return false
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function hasCommand(command: string, extraDirectories: string[] = []): boolean {
  if (!command || command.includes(path.sep) || command.includes('\0')) return false
  return candidateDirectories(extraDirectories).some((directory) => isExecutableFile(path.join(directory, command)))
}
