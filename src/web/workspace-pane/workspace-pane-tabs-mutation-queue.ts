import PQueue from 'p-queue'

const workspacePaneTabsMutationQueue = new PQueue({ concurrency: 1 })

/**
 * Serializes full-list workspace pane tab writes. Callers that do
 * read-modify-write must place the read and the server commit inside this
 * boundary so every mutation observes the latest canonical cache state.
 */
export async function runWorkspacePaneTabsMutation<T>(mutation: () => T | Promise<T>): Promise<T> {
  return await workspacePaneTabsMutationQueue.add(mutation)
}
