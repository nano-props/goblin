import { useEffect, useState } from 'react'
import { getRemotePathSuggestions } from '#/web/remote-workspace-client.ts'
import { isResolvableRemotePathInput } from '#/shared/remote-workspace.ts'
const REMOTE_PATH_SUGGESTIONS_DEBOUNCE_MS = 350

interface RemotePathSuggestionsState {
  suggestions: string[]
  isLoading: boolean
  hasFetched: boolean
}

export function useRemotePathSuggestions(input: {
  enabled: boolean
  alias: string
  remotePath: string
  prefix: string
}) {
  const [state, setState] = useState<RemotePathSuggestionsState>({
    suggestions: [],
    isLoading: false,
    hasFetched: false,
  })

  useEffect(() => {
    if (!input.enabled) {
      setState({ suggestions: [], isLoading: false, hasFetched: false })
      return
    }
    const alias = input.alias.trim()
    const prefix = input.prefix.trim()
    if (!alias || !isResolvableRemotePathInput(prefix)) {
      setState({ suggestions: [], isLoading: false, hasFetched: false })
      return
    }
    // A new valid query restarts the debounce window. Clear the loading
    // flag immediately so the UI only shows loading once the debounced
    // request for the current query has actually started.
    setState((current) => ({ ...current, isLoading: false }))
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, isLoading: true }))
      void getRemotePathSuggestions(
        {
          alias,
          remotePath: input.remotePath.trim() || '/',
          prefix,
        },
        ctrl.signal,
      )
        .then((items) => {
          if (ctrl.signal.aborted) return
          if (!Array.isArray(items)) {
            setState({ suggestions: [], isLoading: false, hasFetched: true })
            return
          }
          // Dedupe while preserving the server's order — the rendering
          // component uses each path as a React key, so duplicates
          // would collide. The server returns siblings under the typed
          // prefix and can list the same path twice in edge cases (e.g.
          // distinct casing). Keep the first occurrence.
          const seen = new Set<string>()
          const unique: string[] = []
          for (const item of items) {
            if (typeof item !== 'string') continue
            if (seen.has(item)) continue
            seen.add(item)
            unique.push(item)
          }
          setState({ suggestions: unique, isLoading: false, hasFetched: true })
        })
        .catch(() => {
          if (!ctrl.signal.aborted) {
            setState({ suggestions: [], isLoading: false, hasFetched: true })
          }
        })
    }, REMOTE_PATH_SUGGESTIONS_DEBOUNCE_MS)
    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [input.alias, input.enabled, input.prefix, input.remotePath])

  return state
}
