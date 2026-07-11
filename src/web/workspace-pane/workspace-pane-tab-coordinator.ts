import PQueue from 'p-queue'
import type { ParsedRepoBranchWorkspacePaneRouteTarget, RepoBranchWorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspacePaneRouteReconciliation } from '#/web/components/repo-workspace/workspace-pane-route-reconciliation.ts'

export type WorkspacePaneTabCoordinatorRoute = RepoBranchWorkspacePaneRouteTarget
export type WorkspacePaneTabCoordinatorObservedRoute = ParsedRepoBranchWorkspacePaneRouteTarget

export interface WorkspacePaneTabCoordinatorTarget {
  repoId: string
  repoRuntimeId: string
  branchName: string | null
  worktreePath: string | null
}

type WorkspacePaneTabTransition = {
  id: number
  repoId: string
  repoRuntimeId: string
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
      repoRuntimeId: string
      branchName: string
      worktreePath: string | null
      fromRoute: WorkspacePaneTabCoordinatorRoute
      toRoute: WorkspacePaneTabCoordinatorRoute
    }
  | { type: 'end-transition'; transitionId: number }
  | {
      type: 'observe-route'
      repoId: string
      repoRuntimeId: string
      branchName: string
      worktreePath: string | null
      route: WorkspacePaneTabCoordinatorObservedRoute
    }

let state: WorkspacePaneTabCoordinatorState = { nextTransitionId: 1, transitions: [] }
const queuesByTarget = new Map<string, PQueue>()
const observedRoutesByTarget = new Map<string, WorkspacePaneTabCoordinatorObservedRoute>()
const latestRepoRuntimeIdByRepo = new Map<string, string>()
const latestObservedTargetKeyByRepo = new Map<string, string | null>()
const transitionCompletionById = new Map<
  number,
  { promise: Promise<boolean>; resolve: (committed: boolean) => void }
>()

export function beginWorkspacePaneTabCoordinatorTransition(input: {
  repoId: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
  fromRoute: WorkspacePaneTabCoordinatorRoute
  toRoute: WorkspacePaneTabCoordinatorRoute
}): number {
  const supersededTransitionIds = state.transitions
    .filter(
      (transition) =>
        transition.repoId === input.repoId &&
        transition.repoRuntimeId === input.repoRuntimeId &&
        transition.branchName === input.branchName &&
        transition.worktreePath === input.worktreePath,
    )
    .map((transition) => transition.id)
  const nextState = reduceWorkspacePaneTabCoordinator(state, {
    type: 'begin-transition',
    repoId: input.repoId,
    repoRuntimeId: input.repoRuntimeId,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    fromRoute: input.fromRoute,
    toRoute: input.toRoute,
  })
  const transition = nextState.transitions.at(-1)
  state = nextState
  for (const transitionId of supersededTransitionIds) settleWorkspacePaneTabCoordinatorTransition(transitionId, false)
  if (transition) {
    let resolve!: (committed: boolean) => void
    const promise = new Promise<boolean>((nextResolve) => {
      resolve = nextResolve
    })
    transitionCompletionById.set(transition.id, { promise, resolve })
  }
  return transition?.id ?? 0
}

export function abortWorkspacePaneTabCoordinatorTransition(transitionId: number | null | undefined): void {
  if (!transitionId) return
  state = reduceWorkspacePaneTabCoordinator(state, { type: 'end-transition', transitionId })
  settleWorkspacePaneTabCoordinatorTransition(transitionId, false)
}

export async function waitForWorkspacePaneTabCoordinatorTransition(
  transitionId: number | null | undefined,
): Promise<boolean> {
  if (!transitionId) return false
  const completion = transitionCompletionById.get(transitionId)
  if (!completion) return false
  try {
    return await completion.promise
  } finally {
    transitionCompletionById.delete(transitionId)
  }
}

export function observeWorkspacePaneTabCoordinatorRoute(input: {
  repoId: string
  repoRuntimeId: string
  branchName: string | null
  worktreePath: string | null
  route: WorkspacePaneTabCoordinatorObservedRoute
}): void {
  latestRepoRuntimeIdByRepo.set(input.repoId, input.repoRuntimeId)
  if (!input.branchName) {
    latestObservedTargetKeyByRepo.set(input.repoId, null)
    return
  }
  const observedTargetKey = workspacePaneTabCoordinatorTargetQueueKey(input)
  if (observedTargetKey) {
    observedRoutesByTarget.set(observedTargetKey, input.route)
    latestObservedTargetKeyByRepo.set(input.repoId, observedTargetKey)
  }
  const transitionsBeforeObservation = state.transitions
  state = reduceWorkspacePaneTabCoordinator(state, {
    type: 'observe-route',
    repoId: input.repoId,
    repoRuntimeId: input.repoRuntimeId,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    route: input.route,
  })
  const exactTarget = (transition: WorkspacePaneTabTransition) =>
    transition.repoId === input.repoId &&
    transition.repoRuntimeId === input.repoRuntimeId &&
    transition.branchName === input.branchName &&
    transition.worktreePath === input.worktreePath
  const supersededIds = transitionsBeforeObservation
    .filter((transition) => transition.repoId === input.repoId && !exactTarget(transition))
    .map((transition) => transition.id)
  if (supersededIds.length > 0) {
    const superseded = new Set(supersededIds)
    state = { ...state, transitions: state.transitions.filter((transition) => !superseded.has(transition.id)) }
    for (const transitionId of supersededIds) settleWorkspacePaneTabCoordinatorTransition(transitionId, false)
  }
  for (const transition of transitionsBeforeObservation.filter(exactTarget)) {
    if (workspacePaneCoordinatorRoutesEqual(input.route, transition.toRoute)) {
      settleWorkspacePaneTabCoordinatorTransition(transition.id, true)
    } else if (!workspacePaneCoordinatorRoutesEqual(input.route, transition.fromRoute)) {
      settleWorkspacePaneTabCoordinatorTransition(transition.id, false)
    }
  }
}

export function workspacePaneTabCoordinatorObservedRoute(
  target: WorkspacePaneTabCoordinatorTarget,
): WorkspacePaneTabCoordinatorObservedRoute | undefined {
  const targetKey = workspacePaneTabCoordinatorTargetQueueKey(target)
  if (!targetKey) return undefined
  return observedRoutesByTarget.get(targetKey)
}

export function workspacePaneTabCoordinatorPendingIntent(
  target: WorkspacePaneTabCoordinatorTarget,
): { fromRoute: WorkspacePaneTabCoordinatorRoute; toRoute: WorkspacePaneTabCoordinatorRoute } | null {
  const pendingTransition = state.transitions.find(
    (transition) =>
      transition.repoId === target.repoId &&
      transition.repoRuntimeId === target.repoRuntimeId &&
      transition.branchName === target.branchName &&
      transition.worktreePath === target.worktreePath,
  )
  return pendingTransition
    ? { fromRoute: pendingTransition.fromRoute, toRoute: pendingTransition.toRoute }
    : null
}

export function workspacePaneTabCoordinatorTargetIsCurrent(target: WorkspacePaneTabCoordinatorTarget): boolean {
  const latestRuntimeId = latestRepoRuntimeIdByRepo.get(target.repoId)
  if (latestRuntimeId !== undefined && latestRuntimeId !== target.repoRuntimeId) return false
  const targetKey = workspacePaneTabCoordinatorTargetQueueKey(target)
  const latestTargetKey = latestObservedTargetKeyByRepo.get(target.repoId)
  return latestTargetKey === undefined || latestTargetKey === targetKey
}

export function leaveWorkspacePaneTabCoordinatorTarget(target: WorkspacePaneTabCoordinatorTarget): void {
  const targetKey = workspacePaneTabCoordinatorTargetQueueKey(target)
  if (!targetKey) return
  observedRoutesByTarget.delete(targetKey)
  if (latestObservedTargetKeyByRepo.get(target.repoId) === targetKey) {
    latestObservedTargetKeyByRepo.set(target.repoId, null)
  }
  const leavingTransitionIds = state.transitions
    .filter(
      (transition) =>
        transition.repoId === target.repoId &&
        transition.repoRuntimeId === target.repoRuntimeId &&
        transition.branchName === target.branchName &&
        transition.worktreePath === target.worktreePath,
    )
    .map((transition) => transition.id)
  if (leavingTransitionIds.length === 0) return
  const leaving = new Set(leavingTransitionIds)
  state = { ...state, transitions: state.transitions.filter((transition) => !leaving.has(transition.id)) }
  for (const transitionId of leavingTransitionIds) settleWorkspacePaneTabCoordinatorTransition(transitionId, false)
}

export function workspacePaneTabCoordinatorReconciliationDeferred(input: {
  repoId: string
  repoRuntimeId: string
  branchName: string | null
  worktreePath: string | null
  route: WorkspacePaneTabCoordinatorObservedRoute
  reconciliation: WorkspacePaneRouteReconciliation
}): boolean {
  if (!input.branchName) return false
  if (input.reconciliation.kind !== 'replace-empty-pane') return false
  return state.transitions.some(
    (transition) =>
      transition.repoId === input.repoId &&
      transition.repoRuntimeId === input.repoRuntimeId &&
      transition.branchName === input.branchName &&
      transition.worktreePath === input.worktreePath &&
      workspacePaneCoordinatorRoutesEqual(input.route, transition.fromRoute),
  )
}

export function resetWorkspacePaneTabCoordinatorForTest(): void {
  state = { nextTransitionId: 1, transitions: [] }
  queuesByTarget.clear()
  observedRoutesByTarget.clear()
  latestRepoRuntimeIdByRepo.clear()
  latestObservedTargetKeyByRepo.clear()
  transitionCompletionById.clear()
}

export function workspacePaneTabCoordinatorStatsForTest(): {
  transitions: number
  transitionCompletions: number
  targetQueues: number
  observedRoutes: number
} {
  return {
    transitions: state.transitions.length,
    transitionCompletions: transitionCompletionById.size,
    targetQueues: queuesByTarget.size,
    observedRoutes: observedRoutesByTarget.size,
  }
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
  return `${target.repoId}\0${target.repoRuntimeId}\0${target.branchName}\0${target.worktreePath ?? ''}`
}

function settleWorkspacePaneTabCoordinatorTransition(transitionId: number, committed: boolean): void {
  transitionCompletionById.get(transitionId)?.resolve(committed)
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
            transition.repoRuntimeId !== event.repoRuntimeId ||
            transition.branchName !== event.branchName ||
            transition.worktreePath !== event.worktreePath,
        ),
        {
          id: current.nextTransitionId,
          repoId: event.repoId,
          repoRuntimeId: event.repoRuntimeId,
          branchName: event.branchName,
          worktreePath: event.worktreePath,
          fromRoute: event.fromRoute,
          toRoute: event.toRoute,
        },
      ],
    }
  }
  if (event.type === 'end-transition') {
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
        transition.repoRuntimeId !== event.repoRuntimeId ||
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
  route: WorkspacePaneTabCoordinatorObservedRoute,
): boolean {
  if (workspacePaneCoordinatorRoutesEqual(route, transition.toRoute)) return false
  return workspacePaneCoordinatorRoutesEqual(route, transition.fromRoute)
}

function workspacePaneCoordinatorRoutesEqual(
  a: WorkspacePaneTabCoordinatorObservedRoute,
  b: WorkspacePaneTabCoordinatorRoute,
): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'static') return b.kind === 'static' && a.tab === b.tab
  if (a.kind === 'terminal') return b.kind === 'terminal' && a.terminalSessionId === b.terminalSessionId
  return false
}
