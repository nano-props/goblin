import { computed, reactive, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
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
  enabled: MaybeRefOrGetter<boolean>
  source: MaybeRefOrGetter<DirectoryPathSuggestionSource>
  prefix: MaybeRefOrGetter<string>
}) {
  const target = computed(() => {
    const source = toValue(input.source)
    const inputPrefix = toValue(input.prefix)
    const prefix = source.kind === 'local' ? inputPrefix : inputPrefix.trim()
    const alias = source.kind === 'ssh' ? source.alias.trim() : ''
    if (!toValue(input.enabled) || !isEligible(source, prefix, alias)) return null
    return {
      source,
      prefix,
      alias,
      identity: `${source.kind}\0${alias}\0${prefix}`,
    }
  })
  const state = shallowRef<SuggestionState>(EMPTY_STATE)

  // The canonical identity owns one debounced request. Raw whitespace changes
  // that normalize to the same target must not cancel and restart it.
  watch(
    () => target.value?.identity ?? '',
    (identity, _previous, onCleanup) => {
      const current = target.value
      if (!identity || !current) {
        state.value = EMPTY_STATE
        return
      }
      const controller = new AbortController()
      const timer = window.setTimeout(() => {
        state.value = { identity: current.identity, suggestions: [], isLoading: true, hasFetched: false }
        const request =
          current.source.kind === 'local'
            ? getLocalDirectoryPathSuggestions(current.prefix, controller.signal)
            : getRemotePathSuggestions({ alias: current.alias, prefix: current.prefix }, controller.signal)
        void request
          .then((items) => {
            if (controller.signal.aborted) return
            const seen = new Set<string>()
            const suggestions = items.filter((item): item is string => {
              if (typeof item !== 'string' || seen.has(item)) return false
              seen.add(item)
              return true
            })
            state.value = { identity: current.identity, suggestions, isLoading: false, hasFetched: true }
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              state.value = { identity: current.identity, suggestions: [], isLoading: false, hasFetched: false }
            }
          })
      }, DIRECTORY_PATH_SUGGESTIONS_DEBOUNCE_MS)
      onCleanup(() => {
        controller.abort()
        window.clearTimeout(timer)
      })
    },
    { immediate: true },
  )

  const currentState = computed(() => (state.value.identity === target.value?.identity ? state.value : EMPTY_STATE))
  return reactive({
    suggestions: computed(() => currentState.value.suggestions),
    isLoading: computed(() => currentState.value.isLoading),
    hasFetched: computed(() => currentState.value.hasFetched),
  })
}

function isEligible(source: DirectoryPathSuggestionSource, prefix: string, alias: string): boolean {
  if (source.kind === 'ssh') return !!alias && isResolvableRemotePathInput(prefix)
  const platform = getPlatform()
  if (platform === 'web') return false
  return platform === 'win32'
    ? prefix === '~' || prefix.startsWith('~\\') || /^[A-Z]:\\/.test(prefix)
    : prefix === '~' || prefix.startsWith('~/') || prefix.startsWith('/')
}
