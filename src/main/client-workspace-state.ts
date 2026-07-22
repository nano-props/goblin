import { app } from 'electron'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type { ClientWorkspaceState, NativeClientWorkspaceReadResult } from '#/shared/api-types.ts'
import { hasErrorCode } from '#/shared/error-code.ts'
import {
  decodeCurrentClientWorkspaceState,
  parseClientWorkspaceStateJson,
  stringifyClientWorkspaceState,
} from '#/shared/client-workspace-state-schema.ts'
import { windowStateNodeLog } from '#/node/logger.ts'

const CLIENT_WORKSPACE_FILE = 'client-workspace.json'
let persistenceQueue: Promise<void> = Promise.resolve()

function clientWorkspaceFile(): string {
  return path.join(app.getPath('userData'), CLIENT_WORKSPACE_FILE)
}

export async function readNativeClientWorkspaceState(): Promise<NativeClientWorkspaceReadResult> {
  return await runPersistenceOperation(readNativeClientWorkspaceStateNow)
}

async function readNativeClientWorkspaceStateNow(): Promise<NativeClientWorkspaceReadResult> {
  const file = clientWorkspaceFile()
  let raw: string
  try {
    raw = await readFile(file, 'utf-8')
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return { kind: 'missing' }
    windowStateNodeLog.warn({ err }, 'failed to read client workspace state')
    throw err
  }
  return { kind: 'loaded', state: parseClientWorkspaceStateJson(raw) }
}

export async function writeNativeClientWorkspaceState(state: ClientWorkspaceState): Promise<void> {
  const file = clientWorkspaceFile()
  const current = decodeCurrentClientWorkspaceState(state)
  await runPersistenceOperation(async () => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, stringifyClientWorkspaceState(current), { encoding: 'utf-8' })
  })
}

function runPersistenceOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = persistenceQueue.then(operation, operation)
  persistenceQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}
