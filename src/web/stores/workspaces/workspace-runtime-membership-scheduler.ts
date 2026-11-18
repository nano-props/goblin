import { KeyedSerialQueue } from '#/web/lib/keyed-serial-queue.ts'

const workspaceRuntimeMembershipQueues = new KeyedSerialQueue()
const activeWorkspaceRuntimeMembershipCommands = new Set<Promise<unknown>>()
let workspaceRuntimeMembershipExclusiveTail: Promise<void> = Promise.resolve()

export async function runWorkspaceRuntimeMembershipCommand<T>(
  workspaceKey: string,
  command: () => Promise<T>,
): Promise<T> {
  const precedingExclusive = workspaceRuntimeMembershipExclusiveTail
  const work = (async () => {
    await precedingExclusive
    return workspaceRuntimeMembershipQueues.run(workspaceKey, command)
  })()
  activeWorkspaceRuntimeMembershipCommands.add(work)
  try {
    return await work
  } finally {
    activeWorkspaceRuntimeMembershipCommands.delete(work)
  }
}

export async function runExclusiveWorkspaceRuntimeMembershipCommand<T>(command: () => Promise<T>): Promise<T> {
  const precedingExclusive = workspaceRuntimeMembershipExclusiveTail
  const precedingShared = Array.from(activeWorkspaceRuntimeMembershipCommands)
  const work = (async () => {
    await precedingExclusive
    await Promise.allSettled(precedingShared)
    return command()
  })()
  workspaceRuntimeMembershipExclusiveTail = work.then(
    () => undefined,
    () => undefined,
  )
  return work
}
