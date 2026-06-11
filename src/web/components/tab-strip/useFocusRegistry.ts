import { useCallback, useRef } from 'react'

export interface FocusRegistry<TKey extends string = string, TElement extends HTMLElement = HTMLElement> {
  setRef: (key: TKey) => (node: TElement | null) => void
  focus: (key: TKey) => void
}

export function useFocusRegistry<TKey extends string, TElement extends HTMLElement = HTMLElement>(): FocusRegistry<
  TKey,
  TElement
> {
  const nodesRef = useRef(new Map<TKey, TElement>())

  const setRef = useCallback(
    (key: TKey) => (node: TElement | null) => {
      if (node) {
        nodesRef.current.set(key, node)
        return
      }
      nodesRef.current.delete(key)
    },
    [],
  )

  const focus = useCallback((key: TKey) => {
    window.requestAnimationFrame(() => {
      nodesRef.current.get(key)?.focus()
    })
  }, [])

  return { setRef, focus }
}
