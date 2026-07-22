import { app } from 'electron'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import {
  CLIENT_WORKSPACE_STATE_VERSION,
  type ClientWorkspaceState,
  type NativeClientWorkspaceReadResult,
} from '#/shared/api-types.ts'
import { hasErrorCode } from '#/shared/error-code.ts'
import { decodeCurrentClientWorkspaceState } from '#/shared/client-workspace-state-schema.ts'
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
  let parsed: Record<string, unknown>
  try {
    const decoded: unknown = JSON.parse(raw)
    if (!isRecord(decoded)) throw new Error('Corrupt native client workspace state')
    parsed = decoded
  } catch (err) {
    throw err
  }
  if ('version' in parsed && parsed.version !== CLIENT_WORKSPACE_STATE_VERSION) {
    throw new Error(`Unsupported native client workspace state version: ${String(parsed.version)}`)
  }
  try {
    if (!hasExactKeys(parsed, ['version', 'state'])) throw new Error('Corrupt native client workspace state envelope')
    if (!isRecord(parsed.state)) throw new Error('Corrupt native client workspace state')
    return { kind: 'loaded', state: decodeCurrentClientWorkspaceState(parsed.state) }
  } catch (err) {
    throw err
  }
}

export async function writeNativeClientWorkspaceState(state: ClientWorkspaceState): Promise<void> {
  const file = clientWorkspaceFile()
  const current = decodeCurrentClientWorkspaceState(state)
  await runPersistenceOperation(async () => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify({ version: CLIENT_WORKSPACE_STATE_VERSION, state: current }, null, 2), {
      encoding: 'utf-8',
    })
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}
