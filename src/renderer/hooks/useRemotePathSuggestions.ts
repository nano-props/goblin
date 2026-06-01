import { useEffect, useState } from 'react'
import { rpc } from '#/renderer/rpc.ts'
import { isResolvableRemotePathInput } from '#/shared/remote-repo.ts'

const REMOTE_PATH_SUGGESTIONS_DEBOUNCE_MS = 350

export function useRemotePathSuggestions(input: {
  enabled: boolean
  alias: string
  remotePath: string
  prefix: string
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])

  useEffect(() => {
    if (!input.enabled) {
      setSuggestions([])
      return
    }
    const alias = input.alias.trim()
    const prefix = input.prefix.trim()
    if (!alias || !isResolvableRemotePathInput(prefix)) {
      setSuggestions([])
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      void rpc.remote.listPathSuggestions
        .query(
          {
            alias,
            remotePath: input.remotePath.trim() || '/',
            prefix,
          },
          { signal: ctrl.signal },
        )
        .then((items) => {
          if (!ctrl.signal.aborted) setSuggestions(Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string') : [])
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setSuggestions([])
        })
    }, REMOTE_PATH_SUGGESTIONS_DEBOUNCE_MS)
    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [input.alias, input.enabled, input.prefix, input.remotePath])

  return suggestions
}
