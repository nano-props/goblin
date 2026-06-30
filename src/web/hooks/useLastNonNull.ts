import { useRef } from 'react'

/**
 * Returns the current `value` if non-null, otherwise the last non-null
 * `value` observed during this component's lifetime (and `null` if no
 * non-null value has ever been seen).
 *
 * Used at dialog host display boundaries so inner content keeps rendering
 * while Radix plays its close animation, after the underlying live value has
 * already been cleared.
 *
 * For the timer-based variant (the value stays retained for `retainMs`
 * after `active` flips to false, useful for transitions with a fixed
 * duration like the compact-workspace pane), see
 * `useRetainedValueDuringExit`.
 *
 * Pre-PR this behaviour was provided by `useRetainedDialogState`,
 * which kept the payload in a `useState` slot across close. The new
 * store clears the slot on close (cleaner data model, no stale
 * payloads) and this hook restores the display continuity at the
 * host boundary.
 */
export function useLastNonNull<T>(value: T | null): T | null {
  const ref = useRef<T | null>(null)
  if (value !== null) ref.current = value
  return value ?? ref.current
}
