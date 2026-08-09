import { computed, shallowReactive } from 'vue'
import type { ComputedRef } from 'vue'

type OverlayRegistryState<TKey extends string> = Record<TKey, boolean>

function createOverlayRegistryState<TKey extends string>(keys: readonly TKey[]): OverlayRegistryState<TKey> {
  const state = {} as OverlayRegistryState<TKey>
  for (const key of keys) state[key] = false
  return state
}

export function useOverlayRegistry<TKey extends string>(
  keys: readonly TKey[],
): {
  state: OverlayRegistryState<TKey>
  anyOpen: ComputedRef<boolean>
  open: (key: TKey) => void
  close: (key: TKey) => void
  setOpen: (key: TKey, open: boolean) => void
  closeAll: () => void
} {
  const state = shallowReactive(createOverlayRegistryState(keys)) as OverlayRegistryState<TKey>

  function setOpen(key: TKey, open: boolean): void {
    state[key] = open
  }

  function closeAll(): void {
    for (const key of keys) state[key] = false
  }

  return {
    state,
    anyOpen: computed(() => keys.some((key) => state[key])),
    open: (key) => setOpen(key, true),
    close: (key) => setOpen(key, false),
    setOpen,
    closeAll,
  }
}
