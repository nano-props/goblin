import { app } from 'electron'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type { ClientWorkspaceState, NativeClientWorkspaceReadResult } from '#/shared/api-types.ts'
import { hasErrorCode } from '#/shared/error-code.ts'
import { windowStateNodeLog } from '#/node/logger.ts'

const CLIENT_WORKSPACE_FILE = 'client-workspace.json'
let writeQueue: Promise<void> = Promise.resolve()

function clientWorkspaceFile(): string {
  return path.join(app.getPath('userData'), CLIENT_WORKSPACE_FILE)
}

export async function readNativeClientWorkspaceState(): Promise<NativeClientWorkspaceReadResult> {
  try {
    return { kind: 'loaded', state: JSON.parse(await readFile(clientWorkspaceFile(), 'utf-8')) }
  } catch (err) {
    if (hasErrorCode(err, 'ENOENT')) return { kind: 'missing' }
    windowStateNodeLog.warn({ err }, 'failed to read client workspace state')
    throw err
  }
}

export async function writeNativeClientWorkspaceState(state: ClientWorkspaceState): Promise<void> {
  const file = clientWorkspaceFile()
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFileAtomic(file, JSON.stringify(state, null, 2), { encoding: 'utf-8' })
    })
  await writeQueue
}
