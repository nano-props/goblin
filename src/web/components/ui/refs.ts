import type { Ref, RefCallback } from 'react'

type RefCleanup = () => void

export function composeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    const cleanups: RefCleanup[] = []
    const callbacksWithoutCleanup: RefCallback<T>[] = []

    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') {
        const cleanup = ref(node)
        if (typeof cleanup === 'function') cleanups.push(cleanup)
        else callbacksWithoutCleanup.push(ref)
        continue
      }
      ref.current = node
    }

    if (node === null) return

    return () => {
      for (let i = cleanups.length - 1; i >= 0; i -= 1) cleanups[i]?.()
      for (let i = callbacksWithoutCleanup.length - 1; i >= 0; i -= 1) callbacksWithoutCleanup[i]?.(null)
      for (const ref of refs) {
        if (ref && typeof ref !== 'function') ref.current = null
      }
    }
  }
}
