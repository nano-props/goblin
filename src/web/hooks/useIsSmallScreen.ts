import { useSyncExternalStore } from 'react'

const SMALL_SCREEN_MEDIA_QUERY = '(max-width: 639px)'
type MatchMediaFn = typeof window.matchMedia
let mediaQuery: MediaQueryList | null = null
let matchMediaRef: MatchMediaFn | null = null
let removeNativeListener: (() => void) | null = null
let currentValue = false
const subscribers = new Set<() => void>()

function cleanupNativeListener() {
  removeNativeListener?.()
  removeNativeListener = null
  mediaQuery = null
  matchMediaRef = null
  currentValue = false
}

function ensureMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    cleanupNativeListener()
    return null
  }
  if (mediaQuery && matchMediaRef === window.matchMedia) return mediaQuery
  cleanupNativeListener()
  matchMediaRef = window.matchMedia
  mediaQuery = window.matchMedia(SMALL_SCREEN_MEDIA_QUERY)
  currentValue = mediaQuery.matches
  const handleChange = () => {
    currentValue = mediaQuery?.matches ?? false
    for (const subscriber of subscribers) subscriber()
  }
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange)
    removeNativeListener = () => mediaQuery?.removeEventListener('change', handleChange)
  } else {
    mediaQuery.addListener(handleChange)
    removeNativeListener = () => mediaQuery?.removeListener(handleChange)
  }
  return mediaQuery
}

function subscribe(onStoreChange: () => void): () => void {
  subscribers.add(onStoreChange)
  ensureMediaQuery()
  return () => {
    subscribers.delete(onStoreChange)
    if (subscribers.size === 0) cleanupNativeListener()
  }
}

function getSnapshot(): boolean {
  ensureMediaQuery()
  return currentValue
}

function getServerSnapshot(): boolean {
  return false
}

export function useIsSmallScreen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
