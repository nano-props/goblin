import type { Draft } from 'immer'
import { appendRepoEvent, errorEvent, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import { runLatestOperation } from '#/renderer/stores/repos/operation-runner.ts'
import {
  finishResourceError,
  finishResourceSuccess,
  startResource,
  type RepoResourceState,
} from '#/renderer/stores/repos/resources.ts'
import type { RepoOperationTarget } from '#/renderer/stores/repos/operation-runner.ts'
import type { RepoState, ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import type { RepoTaskLane } from '#/renderer/stores/repos/runtime.ts'

type RepoDraft = Draft<RepoState>

export interface RunLatestResourceOperationOptions<T> {
  set: ReposSet
  get: ReposGet
  id: string
  token: number
  lane: RepoTaskLane
  operationKey: string
  priority: number
  target: RepoOperationTarget
  selectResource: (repo: RepoDraft) => RepoResourceState
  start?: (repo: RepoDraft) => { hasData?: boolean } | void
  task: (signal: AbortSignal) => Promise<T>
  applyResult: (repo: RepoDraft, result: T) => boolean | void
  onSuccess?: (result: T, ctx: { isCurrent: () => boolean }) => void | Promise<void>
  onError?: (message: string, repo: RepoDraft) => void
  errorLog?: string
}

export async function runLatestResourceOperation<T>(options: RunLatestResourceOperationOptions<T>): Promise<void> {
  updateIfFresh(options.set, options.id, options.token, (repo) => {
    const startOptions = options.start?.(repo)
    startResource(options.selectResource(repo), startOptions ?? undefined)
  })
  await runLatestOperation({
    set: options.set,
    get: options.get,
    id: options.id,
    token: options.token,
    lane: options.lane,
    operationKey: options.operationKey,
    priority: options.priority,
    targets: [options.target],
    task: options.task,
    onResult: async (result, ctx) => {
      updateIfFresh(options.set, options.id, options.token, (repo) => {
        const shouldFinish = options.applyResult(repo, result)
        if (shouldFinish === false) return
        finishResourceSuccess(options.selectResource(repo))
      })
      await options.onSuccess?.(result, ctx)
    },
    onError: (message) => {
      if (options.errorLog) console.warn(options.errorLog, message)
      updateIfFresh(options.set, options.id, options.token, (repo) => {
        finishResourceError(options.selectResource(repo), message)
        options.onError?.(message, repo)
        repo.events = appendRepoEvent(repo.events, errorEvent(message))
      })
    },
  })
}
