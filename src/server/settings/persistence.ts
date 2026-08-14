import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { serverDataFile } from '#/shared/data-dir.ts'
import { hasErrorCode } from '#/shared/error-code.ts'
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

export type UserSettingsJsonReadResult = { kind: 'missing' } | { kind: 'loaded'; value: unknown }

function userSettingsPath(): string {
  return serverDataFile(USER_SETTINGS_FILE)
}

export async function readUserSettingsJson(): Promise<UserSettingsJsonReadResult> {
  const file = userSettingsPath()
  try {
    const raw = await readFile(file, 'utf-8')
    return { kind: 'loaded', value: JSON.parse(raw) }
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return { kind: 'missing' }
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
}
