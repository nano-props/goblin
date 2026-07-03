import { useCallback, useMemo, useRef } from 'react'

export interface FocusRegistry<TKey extends string = string, TElement extends HTMLElement = HTMLElement> {
  setRef: (key: TKey) => (node: TElement | null) => void
  getRef: (key: TKey) => TElement | null
  focus: (key: TKey, options?: FocusOptions) => void
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

  const getRef = useCallback((key: TKey) => nodesRef.current.get(key) ?? null, [])

  const focus = useCallback((key: TKey, options?: FocusOptions) => {
    window.requestAnimationFrame(() => {
      nodesRef.current.get(key)?.focus(options)
    })
  }, [])

  return useMemo(() => ({ setRef, getRef, focus }), [focus, getRef, setRef])
}
