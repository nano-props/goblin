const ACTIVITY_CONFIRM_DELAY_MS = 5000
const ACTIVITY_IDLE_TIMEOUT_MS = 5000
const ACTIVITY_MIN_VISIBLE_MS = 1000
type ActivityTimer = ReturnType<typeof setTimeout>

export interface TerminalActivityState {
  hasRecentActivity: (terminalKey: string) => boolean
  markActivity: (terminalKey: string, terminalWorktreeKey: string) => void
  remove: (terminalKey: string) => void
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

  function deleteRecord(terminalKey: string, record: ActivityRecord): void {
    clearRecordTimers(record)
    records.delete(terminalKey)
  }

  function activateActivity(terminalKey: string, record: ActivityRecord): void {
    if (record.confirmTimer) {
      clearTimer(record.confirmTimer)
      record.confirmTimer = null
    }
    record.pendingSince = null
    record.activeSince = now()
    scheduleIdleExpiry(terminalKey)
    notifyWorktree(record.terminalWorktreeKey)
  }

  function activityExpiresAt(record: ActivityRecord): number {
    const idleExpiresAt = record.lastActivityAt + ACTIVITY_IDLE_TIMEOUT_MS
    return record.activeSince === null
      ? idleExpiresAt
      : Math.max(idleExpiresAt, record.activeSince + ACTIVITY_MIN_VISIBLE_MS)
  }

  function confirmActivity(terminalKey: string): void {
    const record = records.get(terminalKey)
    if (!record || record.pendingSince === null) return
    record.confirmTimer = null
    if (now() - record.lastActivityAt >= ACTIVITY_IDLE_TIMEOUT_MS) {
      deleteRecord(terminalKey, record)
      return
    }
    if (record.lastActivityAt - record.pendingSince >= ACTIVITY_CONFIRM_DELAY_MS) activateActivity(terminalKey, record)
  }

  function expireIdleActivity(terminalKey: string): void {
    const record = records.get(terminalKey)
    if (!record) return
    record.idleTimer = null
    const remainingMs = activityExpiresAt(record) - now()
    if (remainingMs > 0) {
      scheduleIdleExpiry(terminalKey)
      return
    }
    const wasActive = record.activeSince !== null
    deleteRecord(terminalKey, record)
    if (wasActive) notifyWorktree(record.terminalWorktreeKey)
  }

  function scheduleConfirmation(terminalKey: string): void {
    const record = records.get(terminalKey)
    if (!record || record.confirmTimer) return
    record.confirmTimer = setTimer(() => confirmActivity(terminalKey), ACTIVITY_CONFIRM_DELAY_MS)
  }

  function scheduleIdleExpiry(terminalKey: string): void {
    const record = records.get(terminalKey)
    if (!record) return
    if (record.idleTimer) return
    const timeout = Math.max(0, activityExpiresAt(record) - now())
    record.idleTimer = setTimer(() => expireIdleActivity(terminalKey), timeout)
  }

  function hasRecentActivity(terminalKey: string): boolean {
    const record = records.get(terminalKey)
    return record !== undefined && record.activeSince !== null
  }

  return {
    hasRecentActivity,
    markActivity(terminalKey, terminalWorktreeKey) {
      const current = now()
      const record = records.get(terminalKey)
      if (record) {
        record.lastActivityAt = current
        record.terminalWorktreeKey = terminalWorktreeKey
      } else {
        records.set(terminalKey, {
          terminalWorktreeKey,
          lastActivityAt: current,
          pendingSince: current,
          activeSince: null,
          confirmTimer: null,
          idleTimer: null,
        })
      }
      if (hasRecentActivity(terminalKey)) {
        scheduleIdleExpiry(terminalKey)
        return
      }
      const nextRecord = records.get(terminalKey)
      if (
        nextRecord &&
        nextRecord.pendingSince !== null &&
        current - nextRecord.pendingSince >= ACTIVITY_CONFIRM_DELAY_MS
      ) {
        activateActivity(terminalKey, nextRecord)
        return
      }
      scheduleIdleExpiry(terminalKey)
      scheduleConfirmation(terminalKey)
    },
    remove(terminalKey) {
      const record = records.get(terminalKey)
      if (record) deleteRecord(terminalKey, record)
    },
    reset() {
      for (const record of records.values()) clearRecordTimers(record)
      records.clear()
    },
  }
}
