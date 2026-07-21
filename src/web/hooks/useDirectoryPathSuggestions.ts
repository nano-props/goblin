import { useEffect, useMemo, useState } from 'react'
import { getRemotePathSuggestions } from '#/web/remote-workspace-client.ts'
import { getLocalDirectoryPathSuggestions } from '#/web/workspace-client.ts'
import { isResolvableRemotePathInput } from '#/shared/remote-workspace.ts'
import { getPlatform } from '#/web/stores/host-info.ts'

const DIRECTORY_PATH_SUGGESTIONS_DEBOUNCE_MS = 350

export type DirectoryPathSuggestionSource = { kind: 'local' } | { kind: 'ssh'; alias: string }

interface SuggestionState {
  identity: string
  suggestions: string[]
  isLoading: boolean
  hasFetched: boolean
}

const EMPTY_STATE: SuggestionState = { identity: '', suggestions: [], isLoading: false, hasFetched: false }

export function useDirectoryPathSuggestions(input: {
  enabled: boolean
  source: DirectoryPathSuggestionSource
  prefix: string
}): Omit<SuggestionState, 'identity'> {
  const prefix = input.source.kind === 'local' ? input.prefix : input.prefix.trim()
  const alias = input.source.kind === 'ssh' ? input.source.alias.trim() : ''
  const eligible = input.enabled && isEligible(input.source, prefix, alias)
  const identity = eligible ? `${input.source.kind}\0${alias}\0${prefix}` : ''
  const [state, setState] = useState<SuggestionState>(EMPTY_STATE)

  useEffect(() => {
    if (!identity) {
      setState(EMPTY_STATE)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState({ identity, suggestions: [], isLoading: true, hasFetched: false })
      const request =
        input.source.kind === 'local'
          ? getLocalDirectoryPathSuggestions(prefix, controller.signal)
          : getRemotePathSuggestions({ alias, prefix }, controller.signal)
      void request
        .then((items) => {
          if (controller.signal.aborted) return
          const seen = new Set<string>()
          const suggestions = items.filter((item): item is string => {
            if (typeof item !== 'string' || seen.has(item)) return false
            seen.add(item)
            return true
          })
          setState({ identity, suggestions, isLoading: false, hasFetched: true })
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({ identity, suggestions: [], isLoading: false, hasFetched: false })
          }
        })
    }, DIRECTORY_PATH_SUGGESTIONS_DEBOUNCE_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [alias, identity, input.source.kind, prefix])

  return useMemo(
    () =>
      state.identity === identity
        ? { suggestions: state.suggestions, isLoading: state.isLoading, hasFetched: state.hasFetched }
        : { suggestions: [], isLoading: false, hasFetched: false },
    [identity, state],
  )
}

function isEligible(source: DirectoryPathSuggestionSource, prefix: string, alias: string): boolean {
  if (source.kind === 'ssh') return !!alias && isResolvableRemotePathInput(prefix)
  const platform = getPlatform()
  if (platform === 'web') return false
  return platform === 'win32'
    ? prefix === '~' || prefix.startsWith('~\\') || /^[A-Z]:\\/.test(prefix)
    : prefix === '~' || prefix.startsWith('~/') || prefix.startsWith('/')
}
