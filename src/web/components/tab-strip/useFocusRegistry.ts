export interface FocusRegistry<TKey extends string = string, TElement extends HTMLElement = HTMLElement> {
  setRef: (key: TKey) => (node: TElement | null) => void
  getRef: (key: TKey) => TElement | null
  focus: (key: TKey, options?: FocusOptions) => void
}

export function useFocusRegistry<TKey extends string, TElement extends HTMLElement = HTMLElement>(): FocusRegistry<
  TKey,
  TElement
> {
  const nodes = new Map<TKey, TElement>()

  return {
    setRef: (key) => (node) => {
      if (node) {
        nodes.set(key, node)
        return
      }
      nodes.delete(key)
    },
    getRef: (key) => nodes.get(key) ?? null,
    focus: (key, options) => {
      window.requestAnimationFrame(() => nodes.get(key)?.focus(options))
    },
  }
}
