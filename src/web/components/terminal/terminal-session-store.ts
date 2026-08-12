import { computed, shallowRef, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import {
  EMPTY_TERMINAL_SNAPSHOT,
  EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
  useTerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import {
  useTerminalProjectionHydrationEntry,
  useTerminalProjectionHydrationPhase,
} from '#/web/stores/terminal-projection-hydration.ts'
import type {
  TerminalProjectionHydrationEntry,
  TerminalProjectionHydrationPhase,
} from '#/web/stores/terminal-projection-hydration.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type {
  TerminalSnapshot,
  TerminalDescriptor,
  TerminalSessionSummary,
  TerminalFilesystemTargetSnapshot,
  WorkspaceTerminalSessionSummary,
} from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export function useTerminalFilesystemTargetField<T>(
  terminalFilesystemTargetKey: MaybeRefOrGetter<string | null>,
  selector: (snapshot: TerminalFilesystemTargetSnapshot) => T,
): ComputedRef<T> {
  const context = useTerminalSessionReadContext()
  const snapshot = shallowRef(EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT)

  // Subscription ownership follows the external filesystem target identity.
  watch(
    () => toValue(terminalFilesystemTargetKey),
    (targetKey, _previous, onCleanup) => {
      const update = () => {
        snapshot.value = targetKey
          ? context.terminalFilesystemTargetSnapshot(targetKey)
          : EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT
      }
      update()
      if (targetKey) onCleanup(context.subscribeTerminalFilesystemTarget(targetKey, update))
    },
    { immediate: true },
  )

  return computed(() => selector(snapshot.value))
}

export function useTerminalSessionField<T>(
  terminalSessionId: MaybeRefOrGetter<string | null>,
  selector: (snapshot: TerminalSnapshot) => T,
): ComputedRef<T> {
  const context = useTerminalSessionReadContext()
  const snapshot = shallowRef(EMPTY_TERMINAL_SNAPSHOT)

  watch(
    () => toValue(terminalSessionId),
    (sessionId, _previous, onCleanup) => {
      const update = () => {
        snapshot.value = sessionId ? context.snapshot(sessionId) : EMPTY_TERMINAL_SNAPSHOT
      }
      update()
      if (sessionId) onCleanup(context.subscribeSnapshot(sessionId, update))
    },
    { immediate: true },
  )

  return computed(() => selector(snapshot.value))
}

export function useTerminalFilesystemTargetCount(
  terminalFilesystemTargetKey: MaybeRefOrGetter<string | null>,
): ComputedRef<number> {
  return useTerminalFilesystemTargetField(terminalFilesystemTargetKey, (snapshot) => snapshot.count)
}

export function useTerminalFilesystemTargetCreatePending(
  terminalFilesystemTargetKey: MaybeRefOrGetter<string | null>,
): ComputedRef<boolean> {
  return useTerminalFilesystemTargetField(terminalFilesystemTargetKey, (snapshot) => snapshot.createPending)
}

export function useTerminalFilesystemTargetBellCount(
  terminalFilesystemTargetKey: MaybeRefOrGetter<string | null>,
): ComputedRef<number> {
  return useTerminalFilesystemTargetField(terminalFilesystemTargetKey, (snapshot) => snapshot.bellCount)
}

export function useWorkspaceTerminalBellCounts(
  workspaceIds: MaybeRefOrGetter<readonly WorkspaceId[]>,
): ComputedRef<Record<string, number>> {
  const { workspaceBellCount, subscribeWorkspaceBellCount } = useTerminalSessionReadContext()
  const counts = shallowRef<Record<string, number>>({})

  watch(
    () => [...toValue(workspaceIds)],
    (nextWorkspaceIds, _previous, onCleanup) => {
      const uniqueWorkspaceIds = Array.from(new Set(nextWorkspaceIds))
      const update = () => {
        counts.value = Object.fromEntries(
          uniqueWorkspaceIds.map((workspaceId) => [workspaceId, workspaceBellCount(workspaceId)]),
        )
      }
      update()
      const unsubscribers = uniqueWorkspaceIds.map((workspaceId) => subscribeWorkspaceBellCount(workspaceId, update))
      onCleanup(() => {
        for (const unsubscribe of unsubscribers) unsubscribe()
      })
    },
    { immediate: true },
  )

  return computed(() => counts.value)
}

export function useWorkspaceTerminalSessions(
  workspaceId: MaybeRefOrGetter<WorkspaceId>,
): ComputedRef<WorkspaceTerminalSessionSummary[]> {
  const { workspaceTerminalSessions, subscribeWorkspaceTerminalSessions } = useTerminalSessionReadContext()
  const sessions = shallowRef<WorkspaceTerminalSessionSummary[]>([])

  watch(
    () => toValue(workspaceId),
    (nextWorkspaceId, _previous, onCleanup) => {
      const update = () => {
        sessions.value = workspaceTerminalSessions(nextWorkspaceId)
      }
      update()
      onCleanup(subscribeWorkspaceTerminalSessions(nextWorkspaceId, update))
    },
    { immediate: true },
  )

  return computed(() => sessions.value)
}

export function useTerminalFilesystemTargetOutputActive(
  terminalFilesystemTargetKey: MaybeRefOrGetter<string | null>,
): ComputedRef<boolean> {
  return useTerminalFilesystemTargetField(terminalFilesystemTargetKey, (snapshot) => snapshot.outputActiveCount > 0)
}

export function useTerminalFilesystemTargetSelectedDescriptor(
  terminalFilesystemTargetKey: MaybeRefOrGetter<string | null>,
): ComputedRef<TerminalDescriptor | null> {
  return useTerminalFilesystemTargetField(terminalFilesystemTargetKey, (snapshot) => snapshot.selectedDescriptor)
}

export function useTerminalFilesystemTargetSessionDescriptor(input: {
  terminalFilesystemTargetKey: MaybeRefOrGetter<string | null>
  terminalSessionId: MaybeRefOrGetter<string | null>
  base: MaybeRefOrGetter<TerminalSessionBase>
}): ComputedRef<TerminalDescriptor | null> {
  const summaries = useTerminalSessionSummaries(input.terminalFilesystemTargetKey)
  return computed(() => {
    const targetKey = toValue(input.terminalFilesystemTargetKey)
    const sessionId = toValue(input.terminalSessionId)
    if (!targetKey || !sessionId) return null
    const session = summaries.value.find((candidate) => candidate.terminalSessionId === sessionId)
    return session ? terminalDescriptor(toValue(input.base), session.terminalSessionId, session.index) : null
  })
}

export function useTerminalSessionSummaries(
  terminalFilesystemTargetKey: MaybeRefOrGetter<string | null>,
): ComputedRef<TerminalSessionSummary[]> {
  return useTerminalFilesystemTargetField(terminalFilesystemTargetKey, (snapshot) => snapshot.sessions)
}

export function useTerminalWorkspaceProjectionPhase(
  workspaceId: MaybeRefOrGetter<WorkspaceId | null>,
): ComputedRef<TerminalProjectionHydrationPhase> {
  const workspaceState = useStoreSelector(workspacesStore, (state) => state.workspaces)
  const workspaceRuntimeId = computed(() => {
    const currentWorkspaceId = toValue(workspaceId)
    return currentWorkspaceId ? workspaceState.value[currentWorkspaceId]?.workspaceRuntimeId : undefined
  })
  return useTerminalProjectionHydrationPhase(workspaceId, workspaceRuntimeId)
}

export function useTerminalWorkspaceProjectionHydrationEntry(
  workspaceId: MaybeRefOrGetter<WorkspaceId | null>,
): ComputedRef<TerminalProjectionHydrationEntry> {
  const workspaceState = useStoreSelector(workspacesStore, (state) => state.workspaces)
  const workspaceRuntimeId = computed(() => {
    const currentWorkspaceId = toValue(workspaceId)
    return currentWorkspaceId ? workspaceState.value[currentWorkspaceId]?.workspaceRuntimeId : undefined
  })
  return useTerminalProjectionHydrationEntry(workspaceId, workspaceRuntimeId)
}

export function useTerminalWorkspaceProjectionReady(
  workspaceId: MaybeRefOrGetter<WorkspaceId | null>,
): ComputedRef<boolean> {
  const phase = useTerminalWorkspaceProjectionPhase(workspaceId)
  return computed(() => phase.value === 'ready')
}

export function useTerminalSnapshot(terminalSessionId: MaybeRefOrGetter<string | null>): ComputedRef<TerminalSnapshot> {
  return useTerminalSessionField(terminalSessionId, (snapshot) => snapshot)
}
