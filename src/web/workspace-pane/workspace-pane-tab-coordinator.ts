import PQueue from 'p-queue'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneRouteReconciliation } from '#/web/components/repo-workspace/workspace-pane-route-reconciliation.ts'

export type WorkspacePaneTabCoordinatorRoute = RepoBranchWorkspacePaneRoute | null

export interface WorkspacePaneTabCoordinatorTarget {
  repoId: string
  branchName: string | null
  worktreePath?: string | null
}

type WorkspacePaneTabTransition = {
  id: number
  repoId: string
  branchName: string
  worktreePath: string | null
  fromRoute: WorkspacePaneTabCoordinatorRoute
  toRoute: WorkspacePaneTabCoordinatorRoute
}

type WorkspacePaneTabCoordinatorState = {
  nextTransitionId: number
  transitions: WorkspacePaneTabTransition[]
}

type WorkspacePaneTabCoordinatorEvent =
  | {
      type: 'begin-transition'
      repoId: string
      branchName: string
      worktreePath: string | null
      fromRoute: WorkspacePaneTabCoordinatorRoute
      toRoute: WorkspacePaneTabCoordinatorRoute
    }
  | { type: 'abort-transition'; transitionId: number }
  | {
      type: 'observe-route'
      repoId: string
      branchName: string
      worktreePath: string | null
      route: WorkspacePaneTabCoordinatorRoute
    }

let state: WorkspacePaneTabCoordinatorState = { nextTransitionId: 1, transitions: [] }
const queuesByTarget = new Map<string, PQueue>()

export function beginWorkspacePaneTabCoordinatorTransition(input: {
  repoId: string
  branchName: string
  worktreePath?: string | null
  fromRoute: WorkspacePaneTabCoordinatorRoute
  toRoute: WorkspacePaneTabCoordinatorRoute
}): number {
  const nextState = reduceWorkspacePaneTabCoordinator(state, {
    type: 'begin-transition',
    repoId: input.repoId,
    branchName: input.branchName,
    worktreePath: input.worktreePath ?? null,
    fromRoute: input.fromRoute,
    toRoute: input.toRoute,
  })
  const transition = nextState.transitions.at(-1)
  state = nextState
  return transition?.id ?? 0
}

export function abortWorkspacePaneTabCoordinatorTransition(transitionId: number | null | undefined): void {
  if (!transitionId) return
  state = reduceWorkspacePaneTabCoordinator(state, { type: 'abort-transition', transitionId })
}

export function observeWorkspacePaneTabCoordinatorRoute(input: {
  repoId: string
  branchName: string | null
  worktreePath?: string | null
  route: WorkspacePaneTabCoordinatorRoute
}): void {
  if (!input.branchName) return
  state = reduceWorkspacePaneTabCoordinator(state, {
    type: 'observe-route',
    repoId: input.repoId,
    branchName: input.branchName,
    worktreePath: input.worktreePath ?? null,
    route: input.route,
  })
}

export function workspacePaneTabCoordinatorReconciliationDeferred(input: {
  repoId: string
  branchName: string | null
  worktreePath?: string | null
  route: WorkspacePaneTabCoordinatorRoute
  reconciliation: WorkspacePaneRouteReconciliation
}): boolean {
  if (!input.branchName) return false
  if (input.reconciliation.kind !== 'replace-empty-pane') return false
  return state.transitions.some(
    (transition) =>
      transition.repoId === input.repoId &&
      transition.branchName === input.branchName &&
      transition.worktreePath === (input.worktreePath ?? null) &&
      workspacePaneCoordinatorRoutesEqual(transition.fromRoute, input.route),
  )
}

export function resetWorkspacePaneTabCoordinatorForTest(): void {
  state = { nextTransitionId: 1, transitions: [] }
  queuesByTarget.clear()
}

export async function runWorkspacePaneTabCoordinatorTask<T>(
  target: WorkspacePaneTabCoordinatorTarget,
  task: () => Promise<T> | T,
): Promise<T> {
  const queueKey = workspacePaneTabCoordinatorTargetQueueKey(target)
  if (!queueKey) return await task()
  const queue = workspacePaneTabCoordinatorQueue(queueKey)
  try {
    return await queue.add(task)
  } finally {
    scheduleWorkspacePaneTabCoordinatorQueueCleanup(queueKey, queue)
  }
}

export function workspacePaneTabCoordinatorTargetQueueKey(target: WorkspacePaneTabCoordinatorTarget): string | null {
  if (!target.branchName) return null
  return `${target.repoId}\0${target.branchName}`
}

function workspacePaneTabCoordinatorQueue(queueKey: string): PQueue {
  let queue = queuesByTarget.get(queueKey)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    queuesByTarget.set(queueKey, queue)
  }
  return queue
}

function scheduleWorkspacePaneTabCoordinatorQueueCleanup(queueKey: string, queue: PQueue): void {
  void queue.onIdle().then(() => {
    if (queuesByTarget.get(queueKey) !== queue) return
    if (queue.size === 0 && queue.pending === 0) queuesByTarget.delete(queueKey)
  })
}

function reduceWorkspacePaneTabCoordinator(
  current: WorkspacePaneTabCoordinatorState,
  event: WorkspacePaneTabCoordinatorEvent,
): WorkspacePaneTabCoordinatorState {
  if (event.type === 'begin-transition') {
    return {
      nextTransitionId: current.nextTransitionId + 1,
      transitions: [
        ...current.transitions.filter(
          (transition) =>
            transition.repoId !== event.repoId ||
            transition.branchName !== event.branchName ||
            transition.worktreePath !== event.worktreePath,
        ),
        {
          id: current.nextTransitionId,
          repoId: event.repoId,
          branchName: event.branchName,
          worktreePath: event.worktreePath,
          fromRoute: event.fromRoute,
          toRoute: event.toRoute,
        },
      ],
    }
  }
  if (event.type === 'abort-transition') {
    return {
      ...current,
      transitions: current.transitions.filter((transition) => transition.id !== event.transitionId),
    }
  }
  return {
    ...current,
    transitions: current.transitions.filter((transition) => {
      if (
        transition.repoId !== event.repoId ||
        transition.branchName !== event.branchName ||
        transition.worktreePath !== event.worktreePath
      ) {
        return true
      }
      return workspacePaneTabTransitionRemainsPendingAfterRouteObservation(transition, event.route)
    }),
  }
}

function workspacePaneTabTransitionRemainsPendingAfterRouteObservation(
  transition: WorkspacePaneTabTransition,
  route: WorkspacePaneTabCoordinatorRoute,
): boolean {
  if (workspacePaneCoordinatorRoutesEqual(route, transition.toRoute)) return false
  return workspacePaneCoordinatorRoutesEqual(route, transition.fromRoute)
}

function workspacePaneCoordinatorRoutesEqual(
  a: WorkspacePaneTabCoordinatorRoute,
  b: WorkspacePaneTabCoordinatorRoute,
): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'static') return b.kind === 'static' && a.tab === b.tab
  if (a.kind === 'terminal') return b.kind === 'terminal' && a.terminalSessionId === b.terminalSessionId
  return false
}
