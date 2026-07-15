import { mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { serverDataFile } from '#/shared/data-dir.ts'
import { serverNodeLog } from '#/node/logger.ts'

const USER_SETTINGS_FILE = 'user-settings.json'

export class SettingsPersistenceWriteError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`failed to persist settings: ${detail}`)
    this.name = 'SettingsPersistenceWriteError'
    this.cause = cause
  }
}

let writeQueue: Promise<void> = Promise.resolve()
let corruptFileCounter = 0

function userSettingsPath(): string {
  return serverDataFile(USER_SETTINGS_FILE)
}

function corruptSettingsPath(file: string): string {
  corruptFileCounter += 1
  return `${file}.corrupt-${Date.now()}-${process.pid}-${corruptFileCounter}`
}

async function quarantineCorruptSettingsFile(file: string, err: unknown): Promise<void> {
  const target = corruptSettingsPath(file)
  try {
    await rename(file, target)
    serverNodeLog.warn({ err, file, target }, 'quarantined corrupt settings file')
  } catch (renameErr) {
    serverNodeLog.warn({ err, renameErr, file }, 'failed to quarantine corrupt settings file')
  }
}

export async function readUserSettingsJson(): Promise<unknown | null> {
  const file = userSettingsPath()
  try {
    const raw = await readFile(file, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    if (err instanceof SyntaxError) {
      await quarantineCorruptSettingsFile(file, err)
      return null
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    serverNodeLog.warn({ err, file }, 'failed to read settings file')
    throw err
  }
}

export async function writeUserSettingsJson(data: unknown): Promise<void> {
  const file = userSettingsPath()
  const payload = JSON.stringify(data, null, 2)
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      try {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFileAtomic(file, payload, { encoding: 'utf-8' })
      } catch (error) {
        throw new SettingsPersistenceWriteError(error)
      }
    })
  return await writeQueue
}

export function resetUserSettingsPersistenceForTests(): void {
  writeQueue = Promise.resolve()
  corruptFileCounter = 0
}
