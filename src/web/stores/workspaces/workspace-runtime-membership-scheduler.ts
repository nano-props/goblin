import PQueue from 'p-queue'

const workspaceRuntimeMembershipQueues = new Map<string, PQueue>()
const activeWorkspaceRuntimeMembershipCommands = new Set<Promise<unknown>>()
let workspaceRuntimeMembershipExclusiveTail: Promise<void> = Promise.resolve()

export async function runWorkspaceRuntimeMembershipCommand<T>(
  workspaceKey: string,
  command: () => Promise<T>,
): Promise<T> {
  const precedingExclusive = workspaceRuntimeMembershipExclusiveTail
  let queue = workspaceRuntimeMembershipQueues.get(workspaceKey)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    workspaceRuntimeMembershipQueues.set(workspaceKey, queue)
  }
  const work = (async () => {
    await precedingExclusive
    return await queue.add(command)
  })()
  activeWorkspaceRuntimeMembershipCommands.add(work)
  try {
    return await work
  } finally {
    activeWorkspaceRuntimeMembershipCommands.delete(work)
    void queue.onIdle().then(() => {
      if (workspaceRuntimeMembershipQueues.get(workspaceKey) === queue && queue.size === 0 && queue.pending === 0) {
        workspaceRuntimeMembershipQueues.delete(workspaceKey)
      }
    })
  }
}

export async function runExclusiveWorkspaceRuntimeMembershipCommand<T>(command: () => Promise<T>): Promise<T> {
  const precedingExclusive = workspaceRuntimeMembershipExclusiveTail
  const precedingShared = Array.from(activeWorkspaceRuntimeMembershipCommands)
  const work = (async () => {
    await precedingExclusive
    await Promise.allSettled(precedingShared)
    return await command()
  })()
  workspaceRuntimeMembershipExclusiveTail = work.then(
    () => undefined,
    () => undefined,
  )
  return await work
}
