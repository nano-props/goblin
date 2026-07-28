import { focusManager, QueryClient } from '@tanstack/react-query'

focusManager.setEventListener((setFocused) => {
  if (
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function' ||
    typeof window.removeEventListener !== 'function' ||
    typeof document === 'undefined' ||
    typeof document.hasFocus !== 'function'
  ) {
    return
  }
  const syncFocusedState = () => {
    setFocused(document.visibilityState !== 'hidden' && document.hasFocus())
  }
  const handlePageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return
    if (document.visibilityState !== 'hidden' && document.hasFocus()) {
      if (focusManager.isFocused()) focusManager.onFocus()
      else setFocused(true)
      return
    }
    syncFocusedState()
  }
  window.addEventListener('focus', syncFocusedState)
  window.addEventListener('blur', syncFocusedState)
  document.addEventListener('visibilitychange', syncFocusedState)
  window.addEventListener('pageshow', handlePageShow)
  return () => {
    window.removeEventListener('focus', syncFocusedState)
    window.removeEventListener('blur', syncFocusedState)
    document.removeEventListener('visibilitychange', syncFocusedState)
    window.removeEventListener('pageshow', handlePageShow)
  }
})

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})
