import { onScopeDispose, readonly, ref } from 'vue'
import type { Ref } from 'vue'

const ACTION_FEEDBACK_MS = 1500

export function useActionFeedback(): {
  succeeded: Readonly<Ref<boolean>>
  trigger: (onSelect: () => boolean | Promise<boolean> | void | Promise<void>) => void
  reset: () => void
} {
  const succeeded = ref(false)
  let timeout: number | null = null
  let scopeActive = true

  function reset(): void {
    if (timeout !== null) window.clearTimeout(timeout)
    timeout = null
    succeeded.value = false
  }

  function trigger(onSelect: () => boolean | Promise<boolean> | void | Promise<void>): void {
    if (!scopeActive) return
    let result: ReturnType<typeof onSelect>
    try {
      result = onSelect()
    } catch {
      return
    }

    void Promise.resolve(result)
      .then((accepted) => {
        if (!scopeActive || !accepted || succeeded.value) return
        succeeded.value = true
        timeout = window.setTimeout(reset, ACTION_FEEDBACK_MS)
      })
      .catch(() => {})
  }

  onScopeDispose(() => {
    scopeActive = false
    reset()
  })
  return { succeeded: readonly(succeeded), trigger, reset }
}
