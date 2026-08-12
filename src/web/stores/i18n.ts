// Client-side i18n. The app entrypoint hydrates this store from
// the public `/api/i18n` endpoint before mounting the normal Vue tree;
// setPref writes through and the broadcast keeps every window in sync.
//
// No initial dictionary is read from the bootstrap: the server
// stopped inlining it into HTML, so the client always starts
// with an empty English resource and the app entrypoint shows a
// static loading/error state until the first hydrate call replaces
// it with the user's preferred language. The `hydrated` flag flips
// to true on the first successful snapshot commit.
// I18n hydration reads the public settings transport; preference writes go
// through settings-actions.

import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { I18nSnapshot } from '#/shared/api-types.ts'
import type { Lang, LangPref } from '#/shared/settings.ts'
import { getI18nSnapshot } from '#/web/settings-client.ts'
import { createSettingsProjectionOwner } from '#/web/settings-projection-owner.ts'
import { setI18nPreference } from '#/web/settings-actions.ts'

export type I18nDictionary = Record<string, string>

interface I18nState {
  lang: Lang
  pref: LangPref
  dict: I18nDictionary
  /**
   * True once `hydrate()` has applied at least one snapshot from
   * `/api/i18n`. UI surfaces that depend on translated
   * strings (the auth gate, the settings pages) gate on this so
   * they never paint with raw i18n keys.
   */
  hydrated: boolean
  hydrate: (options?: {
    /** False for entrypoint bootstrap: fetch `/api/i18n` without opening the auth-gated invalidation socket. */
    subscribe?: boolean
    signal?: AbortSignal
  }) => Promise<void>
  /** Install the authenticated invalidation stream without fetching the snapshot again. */
  subscribeInvalidation: () => void
  setPref: (pref: LangPref) => Promise<void>
}

type I18nSet = StoreApi<I18nState>['setState']

let unsubscribe: (() => void) | null = null
const projectionOwner = createSettingsProjectionOwner('i18n')

function ensureI18nSubscription(set: I18nSet): void {
  if (unsubscribe) return
  unsubscribe = projectionOwner.subscribe({
    scope: 'i18n',
    read: getI18nSnapshot,
    apply: (next) => commitSnapshot(set, next),
  })
}

export const i18nStore = createStore<I18nState>((set) => ({
  lang: 'en',
  pref: 'auto',
  dict: {},
  hydrated: false,

  async hydrate(options) {
    await projectionOwner.run(async () => {
      commitSnapshot(set, await getI18nSnapshot({ signal: options?.signal }))
    })
    if (options?.subscribe === false) return
    ensureI18nSubscription(set)
  },

  subscribeInvalidation() {
    ensureI18nSubscription(set)
  },

  async setPref(pref) {
    await projectionOwner.run(async () => {
      commitSnapshot(set, await setI18nPreference(pref))
      ensureI18nSubscription(set)
    })
  },
}))

function commitSnapshot(set: I18nSet, snapshot: I18nSnapshot): void {
  const current = i18nStore.getState()
  if (sameSnapshot(current, snapshot)) return
  set((s) =>
    sameSnapshot(s, snapshot) ? s : { lang: snapshot.lang, pref: snapshot.pref, dict: snapshot.dict, hydrated: true },
  )
}

function sameSnapshot(state: Pick<I18nState, 'lang' | 'pref' | 'dict'>, snapshot: I18nSnapshot): boolean {
  if (state.lang !== snapshot.lang || state.pref !== snapshot.pref) return false
  const stateKeys = Object.keys(state.dict)
  const snapshotKeys = Object.keys(snapshot.dict)
  if (stateKeys.length !== snapshotKeys.length) return false
  return stateKeys.every((key) => state.dict[key] === snapshot.dict[key])
}
