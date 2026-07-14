import { app } from 'electron'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import { windowStateNodeLog } from '#/node/logger.ts'

const CLIENT_WORKSPACE_FILE = 'client-workspace.json'
let writeQueue: Promise<void> = Promise.resolve()

function clientWorkspaceFile(): string {
  return path.join(app.getPath('userData'), CLIENT_WORKSPACE_FILE)
}

export async function readNativeClientWorkspaceState(): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(clientWorkspaceFile(), 'utf-8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      windowStateNodeLog.warn({ err }, 'failed to read client workspace state')
    }
    return null
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
