const ACTIVITY_CONFIRM_DELAY_MS = 5000
const ACTIVITY_IDLE_TIMEOUT_MS = 5000
const ACTIVITY_MIN_VISIBLE_MS = 1000
type ActivityTimer = ReturnType<typeof setTimeout>

export interface TerminalActivityState {
  hasRecentActivity: (terminalSessionId: string) => boolean
  markActivity: (terminalSessionId: string, terminalWorktreeKey: string) => void
  remove: (terminalSessionId: string) => void
  reset: () => void
}

interface ActivityRecord {
  terminalWorktreeKey: string
  lastActivityAt: number
  pendingSince: number | null
  activeSince: number | null
  confirmTimer: ActivityTimer | null
  idleTimer: ActivityTimer | null
}

export function createTerminalActivityState(
  notifyWorktree: (terminalWorktreeKey: string) => void,
  now: () => number = () => Date.now(),
  setTimer: (handler: () => void, timeout: number) => ActivityTimer = (handler, timeout) =>
    setTimeout(handler, timeout),
  clearTimer: (timer: ActivityTimer) => void = (timer) => clearTimeout(timer),
): TerminalActivityState {
  const records = new Map<string, ActivityRecord>()

  function clearRecordTimers(record: ActivityRecord): void {
    if (record.confirmTimer) clearTimer(record.confirmTimer)
    if (record.idleTimer) clearTimer(record.idleTimer)
  }

  function deleteRecord(terminalSessionId: string, record: ActivityRecord): void {
    clearRecordTimers(record)
    records.delete(terminalSessionId)
  }

  function activateActivity(terminalSessionId: string, record: ActivityRecord): void {
    if (record.confirmTimer) {
      clearTimer(record.confirmTimer)
      record.confirmTimer = null
    }
    record.pendingSince = null
    record.activeSince = now()
    scheduleIdleExpiry(terminalSessionId)
    notifyWorktree(record.terminalWorktreeKey)
  }

  function activityExpiresAt(record: ActivityRecord): number {
    const idleExpiresAt = record.lastActivityAt + ACTIVITY_IDLE_TIMEOUT_MS
    return record.activeSince === null
      ? idleExpiresAt
      : Math.max(idleExpiresAt, record.activeSince + ACTIVITY_MIN_VISIBLE_MS)
  }

  function confirmActivity(terminalSessionId: string): void {
    const record = records.get(terminalSessionId)
    if (!record || record.pendingSince === null) return
    record.confirmTimer = null
    if (now() - record.lastActivityAt >= ACTIVITY_IDLE_TIMEOUT_MS) {
      deleteRecord(terminalSessionId, record)
      return
    }
    if (record.lastActivityAt - record.pendingSince >= ACTIVITY_CONFIRM_DELAY_MS) activateActivity(terminalSessionId, record)
  }

  function expireIdleActivity(terminalSessionId: string): void {
    const record = records.get(terminalSessionId)
    if (!record) return
    record.idleTimer = null
    const remainingMs = activityExpiresAt(record) - now()
    if (remainingMs > 0) {
      scheduleIdleExpiry(terminalSessionId)
      return
    }
    const wasActive = record.activeSince !== null
    deleteRecord(terminalSessionId, record)
    if (wasActive) notifyWorktree(record.terminalWorktreeKey)
  }

  function scheduleConfirmation(terminalSessionId: string): void {
    const record = records.get(terminalSessionId)
    if (!record || record.confirmTimer) return
    record.confirmTimer = setTimer(() => confirmActivity(terminalSessionId), ACTIVITY_CONFIRM_DELAY_MS)
  }

  function scheduleIdleExpiry(terminalSessionId: string): void {
    const record = records.get(terminalSessionId)
    if (!record) return
    if (record.idleTimer) return
    const timeout = Math.max(0, activityExpiresAt(record) - now())
    record.idleTimer = setTimer(() => expireIdleActivity(terminalSessionId), timeout)
  }

  function hasRecentActivity(terminalSessionId: string): boolean {
    const record = records.get(terminalSessionId)
    return record !== undefined && record.activeSince !== null
  }

  return {
    hasRecentActivity,
    markActivity(terminalSessionId, terminalWorktreeKey) {
      const current = now()
      const record = records.get(terminalSessionId)
      if (record) {
        record.lastActivityAt = current
        record.terminalWorktreeKey = terminalWorktreeKey
      } else {
        records.set(terminalSessionId, {
          terminalWorktreeKey,
          lastActivityAt: current,
          pendingSince: current,
          activeSince: null,
          confirmTimer: null,
          idleTimer: null,
        })
      }
      if (hasRecentActivity(terminalSessionId)) {
        scheduleIdleExpiry(terminalSessionId)
        return
      }
      const nextRecord = records.get(terminalSessionId)
      if (
        nextRecord &&
        nextRecord.pendingSince !== null &&
        current - nextRecord.pendingSince >= ACTIVITY_CONFIRM_DELAY_MS
      ) {
        activateActivity(terminalSessionId, nextRecord)
        return
      }
      scheduleIdleExpiry(terminalSessionId)
      scheduleConfirmation(terminalSessionId)
    },
    remove(terminalSessionId) {
      const record = records.get(terminalSessionId)
      if (record) deleteRecord(terminalSessionId, record)
    },
    reset() {
      for (const record of records.values()) clearRecordTimers(record)
      records.clear()
    },
  }
}
