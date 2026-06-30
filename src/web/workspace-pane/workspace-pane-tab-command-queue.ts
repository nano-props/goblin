import PQueue from 'p-queue'

const workspacePaneTabCommandQueue = new PQueue({ concurrency: 1 })

/**
 * Serializes workspace pane tab commits so rapid open/close/reorder commands
 * read a stable latest tab list and apply the server's canonical response in
 * order.
 */
export async function runWorkspacePaneTabUiCommand<T>(command: () => T | Promise<T>): Promise<T> {
  return await workspacePaneTabCommandQueue.add(command)
}
