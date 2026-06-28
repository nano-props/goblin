import PQueue from 'p-queue'

const workspacePaneTabCommandQueue = new PQueue({ concurrency: 1 })

/**
 * Serializes workspace pane tab UI commits only.
 *
 * Terminal/server resource IO must happen outside this queue. Enqueue only the
 * synchronous state commit that reads the latest workspace pane state and
 * writes the final UI state.
 */
export function runWorkspacePaneTabUiCommand<T>(command: () => T): Promise<T> {
  return workspacePaneTabCommandQueue.add(command)
}
