const ACTIVITY_CONFIRM_DELAY_MS = 5000
const ACTIVITY_IDLE_TIMEOUT_MS = 5000
const ACTIVITY_MIN_VISIBLE_MS = 1000
type ActivityTimer = ReturnType<typeof setTimeout>

export interface TerminalActivityState {
  hasRecentActivity: (key: string) => boolean
  markActivity: (key: string, worktreeTerminalKey: string) => void
  remove: (key: string) => void
  reset: () => void
}

interface ActivityRecord {
  worktreeTerminalKey: string
  lastActivityAt: number
  pendingSince: number | null
  activeSince: number | null
  confirmTimer: ActivityTimer | null
  idleTimer: ActivityTimer | null
}

export function createTerminalActivityState(
  notifyWorktree: (worktreeTerminalKey: string) => void,
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

  function deleteRecord(key: string, record: ActivityRecord): void {
    clearRecordTimers(record)
    records.delete(key)
  }

  function activateActivity(key: string, record: ActivityRecord): void {
    if (record.confirmTimer) {
      clearTimer(record.confirmTimer)
      record.confirmTimer = null
    }
    record.pendingSince = null
    record.activeSince = now()
    scheduleIdleExpiry(key)
    notifyWorktree(record.worktreeTerminalKey)
  }

  function confirmActivity(key: string): void {
    const record = records.get(key)
    if (!record || record.pendingSince === null) return
    record.confirmTimer = null
    if (now() - record.lastActivityAt >= ACTIVITY_IDLE_TIMEOUT_MS) {
      deleteRecord(key, record)
      return
    }
    if (record.lastActivityAt - record.pendingSince >= ACTIVITY_CONFIRM_DELAY_MS) activateActivity(key, record)
  }

  function expireIdleActivity(key: string): void {
    const record = records.get(key)
    if (!record) return
    record.idleTimer = null
    const current = now()
    const remainingMs = ACTIVITY_IDLE_TIMEOUT_MS - (current - record.lastActivityAt)
    if (remainingMs > 0) {
      scheduleIdleExpiry(key)
      return
    }
    const minVisibleRemainingMs =
      record.activeSince === null ? 0 : ACTIVITY_MIN_VISIBLE_MS - Math.max(0, current - record.activeSince)
    if (minVisibleRemainingMs > 0) {
      record.idleTimer = setTimer(() => expireIdleActivity(key), minVisibleRemainingMs)
      return
    }
    const wasActive = record.activeSince !== null
    deleteRecord(key, record)
    if (wasActive) notifyWorktree(record.worktreeTerminalKey)
  }

  function scheduleConfirmation(key: string): void {
    const record = records.get(key)
    if (!record || record.confirmTimer) return
    record.confirmTimer = setTimer(() => confirmActivity(key), ACTIVITY_CONFIRM_DELAY_MS)
  }

  function scheduleIdleExpiry(key: string): void {
    const record = records.get(key)
    if (!record) return
    if (record.idleTimer) clearTimer(record.idleTimer)
    const timeout = Math.max(0, ACTIVITY_IDLE_TIMEOUT_MS - (now() - record.lastActivityAt))
    record.idleTimer = setTimer(() => expireIdleActivity(key), timeout)
  }

  function hasRecentActivity(key: string): boolean {
    const record = records.get(key)
    return record !== undefined && record.activeSince !== null
  }

  return {
    hasRecentActivity,
    markActivity(key, worktreeTerminalKey) {
      const current = now()
      const record = records.get(key)
      if (record) {
        record.lastActivityAt = current
        record.worktreeTerminalKey = worktreeTerminalKey
      } else {
        records.set(key, {
          worktreeTerminalKey,
          lastActivityAt: current,
          pendingSince: current,
          activeSince: null,
          confirmTimer: null,
          idleTimer: null,
        })
      }
      if (hasRecentActivity(key)) {
        scheduleIdleExpiry(key)
        return
      }
      scheduleIdleExpiry(key)
      const nextRecord = records.get(key)
      if (
        nextRecord &&
        nextRecord.pendingSince !== null &&
        current - nextRecord.pendingSince >= ACTIVITY_CONFIRM_DELAY_MS
      ) {
        activateActivity(key, nextRecord)
        return
      }
      scheduleConfirmation(key)
    },
    remove(key) {
      const record = records.get(key)
      if (record) deleteRecord(key, record)
    },
    reset() {
      for (const record of records.values()) clearRecordTimers(record)
      records.clear()
    },
  }
}
