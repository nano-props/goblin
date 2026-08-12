import { subscribeSettingsInvalidation } from '#/web/settings-invalidation-ingress.ts'
import { settingsLog } from '#/web/logger.ts'
import type { SettingsInvalidationScope } from '#/shared/server-invalidation.ts'

interface SettingsProjectionSubscription<T> {
  scope: SettingsInvalidationScope
  read: () => Promise<T>
  apply: (value: T) => void | Promise<void>
}

export function createSettingsProjectionOwner(label: string) {
  let projectionTail = Promise.resolve()

  function run<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = projectionTail.then(operation)
    projectionTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function subscribe<T>(subscription: SettingsProjectionSubscription<T>): () => void {
    let disposed = false
    let invalidated = false
    let refreshEnqueued = false

    const requestRefresh = () => {
      if (disposed) return
      invalidated = true
      if (refreshEnqueued) return
      refreshEnqueued = true
      void run(async () => {
        while (invalidated && !disposed) {
          invalidated = false
          const value = await subscription.read()
          if (!disposed) await subscription.apply(value)
        }
      })
        .catch((err) => {
          settingsLog.warn(`${label} web sync failed`, { err })
        })
        .finally(() => {
          refreshEnqueued = false
          if (invalidated && !disposed) requestRefresh()
        })
    }

    const unsubscribe = subscribeSettingsInvalidation((event) => {
      if (event.scopes.includes(subscription.scope)) requestRefresh()
    })

    return () => {
      disposed = true
      invalidated = false
      unsubscribe()
    }
  }

  return { run, subscribe }
}
