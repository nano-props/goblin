import type { Draft } from 'immer'
import { appendRepoEvent, errorEvent, updateIfFresh } from '#/web/stores/repos/helpers.ts'
import { runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import {
  finishResourceError,
  finishResourceSuccess,
  startResource,
  type RepoResourceState,
} from '#/web/stores/repos/resources.ts'
import type { RepoOperationTarget } from '#/web/stores/repos/operation-runner.ts'
import type { RepoState, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { RepoTaskLane } from '#/web/stores/repos/runtime.ts'
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
  /**
   * Hook for the caller to log the failure through its own logger
   * (e.g. `(msg) => refreshStatusLog.warn('failed', { err: new Error(msg) })`).
   * Runs before the state update so the log line precedes the UI mutation
   * in the timeline; the test silent-in-test policy applies because this
   * routes through the caller's `xxxLog`, not raw `console.*`.
   */
  onErrorLog?: (message: string) => void
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
      options.onErrorLog?.(message)
      updateIfFresh(options.set, options.id, options.token, (repo) => {
        finishResourceError(options.selectResource(repo), message)
        options.onError?.(message, repo)
        repo.events = appendRepoEvent(repo.events, errorEvent(message))
      })
    },
  })
}
