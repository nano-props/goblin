import { subscribeSettingsInvalidation } from '#/web/settings-invalidation-source.ts'
import type { SettingsInvalidationScope } from '#/shared/server-invalidation.ts'
interface SettingsInvalidationSubscriptionOptions<T> {
  scope: SettingsInvalidationScope
  fetch: () => Promise<T>
  apply: (value: T) => void | Promise<void>
  label: string
}

export function subscribeSettingsRefetch<T>({
  scope,
  fetch,
  apply,
  label,
}: SettingsInvalidationSubscriptionOptions<T>): () => void {
  let inFlight: Promise<void> | null = null
  let rerunRequested = false
  let disposed = false

  const run = () => {
    if (disposed) return
    if (inFlight) {
      rerunRequested = true
      return
    }
    inFlight = fetch()
      .then((value) => apply(value))
      .catch((err) => {
        console.warn(`[${label}] web sync failed`, err)
      })
      .finally(() => {
        inFlight = null
        if (rerunRequested && !disposed) {
          rerunRequested = false
          run()
        }
      })
  }

  const unsubscribe = subscribeSettingsInvalidation((event) => {
    if (!event.scopes.includes(scope)) return
    run()
  })

  return () => {
    disposed = true
    unsubscribe()
  }
}
