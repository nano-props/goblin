import { useCallback, useMemo, useReducer } from 'react'

// Generic boolean open/close registry only. Keep overlay-specific payload and
// reset rules in app/domain hooks (for example useAppOverlays) so this helper
// stays small and does not turn into a catch-all overlay framework.
type OverlayRegistryState<TKey extends string> = Record<TKey, boolean>

type OverlayRegistryAction<TKey extends string> = { type: 'set'; key: TKey; open: boolean } | { type: 'close-all' }

function createOverlayRegistryState<TKey extends string>(keys: readonly TKey[]): OverlayRegistryState<TKey> {
  const state = {} as OverlayRegistryState<TKey>
  for (const key of keys) state[key] = false
  return state
}

function reduceOverlayRegistry<TKey extends string>(
  state: OverlayRegistryState<TKey>,
  action: OverlayRegistryAction<TKey>,
): OverlayRegistryState<TKey> {
  switch (action.type) {
    case 'set':
      return state[action.key] === action.open ? state : { ...state, [action.key]: action.open }
    case 'close-all': {
      let changed = false
      const next = {} as OverlayRegistryState<TKey>
      for (const key of Object.keys(state) as TKey[]) {
        changed = changed || state[key]
        next[key] = false
      }
      return changed ? next : state
    }
  }
}

export function useOverlayRegistry<TKey extends string>(keys: readonly TKey[]) {
  const [state, dispatch] = useReducer(reduceOverlayRegistry<TKey>, keys, createOverlayRegistryState)

  const setOpen = useCallback((key: TKey, open: boolean) => {
    dispatch({ type: 'set', key, open })
  }, [])

  const open = useCallback((key: TKey) => {
    dispatch({ type: 'set', key, open: true })
  }, [])

  const close = useCallback((key: TKey) => {
    dispatch({ type: 'set', key, open: false })
  }, [])

  const closeAll = useCallback(() => {
    dispatch({ type: 'close-all' })
  }, [])

  const anyOpen = useMemo(() => {
    return Object.values(state).some(Boolean)
  }, [state])

  return {
    state,
    anyOpen,
    open,
    close,
    setOpen,
    closeAll,
  }
}
