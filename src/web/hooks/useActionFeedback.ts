import { useCallback, useEffect, useState } from 'react'

const ACTION_FEEDBACK_MS = 1500

// Transient "success" affordance for a click-and-confirm button:
// drive `onSelect`, flip `succeeded` to true on a truthy result, then
// revert after ~1.5s. The `[succeeded]` effect's cleanup clears the
// timer on unmount, so we never call setState on an unmounted instance
// in practice. The action dispatcher surfaces failure toasts itself, so
// the hook stays quiet on error. `reset` lets parents drop the flash
// when the underlying value changes (e.g. the row being copied from
// swaps out).
export function useActionFeedback() {
  const [succeeded, setSucceeded] = useState(false)

  useEffect(() => {
    if (!succeeded) return
    const timer = window.setTimeout(() => setSucceeded(false), ACTION_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [succeeded])

  const trigger = (onSelect: () => boolean | Promise<boolean> | void | Promise<void>) => {
    // Call onSelect synchronously to match the legacy click contract
    // (callers expect the action to fire on the same tick as the
    // click). Sync throws are caught here, async rejections below.
    let result: ReturnType<typeof onSelect>
    try {
      result = onSelect()
    } catch {
      return
    }
    void Promise.resolve(result)
      .then((ok) => {
        if (ok) setSucceeded(true)
      })
      .catch(() => {})
  }

  const reset = useCallback(() => setSucceeded(false), [])

  return { succeeded, trigger, reset }
}
