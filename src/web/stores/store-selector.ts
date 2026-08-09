import { onScopeDispose, shallowRef } from 'vue'
import type { ShallowRef } from 'vue'
import type { StoreApi } from 'zustand/vanilla'

export function useStoreSelector<State, Selection>(
  store: StoreApi<State>,
  selector: (state: State) => Selection,
  equal: (left: Selection, right: Selection) => boolean = Object.is,
): Readonly<ShallowRef<Selection>> {
  const selection = shallowRef(selector(store.getState())) as ShallowRef<Selection>
  const unsubscribe = store.subscribe((state) => {
    const next = selector(state)
    if (!equal(selection.value, next)) selection.value = next
  })
  onScopeDispose(unsubscribe)
  return selection
}
