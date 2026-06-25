// Client-side i18n. The app entrypoint hydrates this store from
// the public `/api/i18n` endpoint before mounting the normal React
// tree; setPref writes through and the broadcast keeps every window
// in sync. React components read translations through react-i18next,
// while this Zustand store keeps the language preference/snapshot
// available to non-hook call sites (Settings controls, ErrorBoundary
// fallback).
//
// No initial dictionary is read from the bootstrap: the server
// stopped inlining it into HTML, so the client always starts
// with an empty English resource and the app entrypoint shows a
// static loading/error state until the first hydrate call replaces
// it with the user's preferred language. The `hydrated` flag flips
// to true on the first successful snapshot commit.

import i18next from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import { create, type StoreApi } from 'zustand'
import type { I18nSnapshot, Lang, LangPref } from '#/shared/api-types.ts'
import { getI18nSnapshot, setI18nPref } from '#/web/settings-client.ts'
import { subscribeSettingsInvalidationRefetch } from '#/web/settings-invalidation-refetch.ts'

export type { Lang, LangPref }
export type Dict = Record<string, string>

void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: {} } },
  defaultNS: 'translation',
  keySeparator: false,
  interpolation: {
    escapeValue: false,
    prefix: '{',
    suffix: '}',
  },
  react: {
    useSuspense: false,
  },
})

interface I18nState {
  lang: Lang
  pref: LangPref
  dict: Dict
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
  setPref: (pref: LangPref) => Promise<void>
}

type I18nSet = StoreApi<I18nState>['setState']

let unsubscribe: (() => void) | null = null
let hydrateVersion = 0
let snapshotQueue = Promise.resolve()

function clearI18nSubscription() {
  unsubscribe?.()
  unsubscribe = null
}

export const useI18nStore = create<I18nState>((set) => ({
  lang: 'en',
  pref: 'auto',
  dict: {},
  hydrated: false,

  async hydrate(options) {
    const version = ++hydrateVersion
    const snapshot = await getI18nSnapshot({ signal: options?.signal })
    if (version !== hydrateVersion) return
    await commitSnapshot(set, snapshot)
    if (version !== hydrateVersion) return
    if (options?.subscribe === false) return
    const nextUnsubscribe = subscribeSettingsInvalidationRefetch({
      scope: 'i18n',
      fetch: getI18nSnapshot,
      label: 'i18n',
      apply: (next) => commitSnapshot(set, next),
    })
    if (version !== hydrateVersion) {
      nextUnsubscribe()
      return
    }
    clearI18nSubscription()
    unsubscribe = nextUnsubscribe
  },

  async setPref(pref) {
    const snapshot = await setI18nPref(pref)
    if (snapshot) {
      await commitSnapshot(set, snapshot)
    }
  },
}))

function commitSnapshot(set: I18nSet, snapshot: I18nSnapshot): Promise<void> {
  const work = snapshotQueue.then(() => commitSnapshotNow(set, snapshot))
  snapshotQueue = work.catch(() => {})
  return work
}

async function commitSnapshotNow(set: I18nSet, snapshot: I18nSnapshot): Promise<void> {
  const current = useI18nStore.getState()
  if (sameSnapshot(current, snapshot)) return
  await applySnapshot(snapshot)
  set((s) =>
    sameSnapshot(s, snapshot) ? s : { lang: snapshot.lang, pref: snapshot.pref, dict: snapshot.dict, hydrated: true },
  )
  document.documentElement.setAttribute('lang', snapshot.lang)
}

function sameSnapshot(state: Pick<I18nState, 'lang' | 'pref' | 'dict'>, snapshot: I18nSnapshot): boolean {
  if (state.lang !== snapshot.lang || state.pref !== snapshot.pref) return false
  const stateKeys = Object.keys(state.dict)
  const snapshotKeys = Object.keys(snapshot.dict)
  if (stateKeys.length !== snapshotKeys.length) return false
  return stateKeys.every((key) => state.dict[key] === snapshot.dict[key])
}

async function applySnapshot(snapshot: { lang: Lang; dict: Dict }): Promise<void> {
  i18next.addResourceBundle(snapshot.lang, 'translation', { ...snapshot.dict }, true, true)
  await i18next.changeLanguage(snapshot.lang)
}

/** Render-bound translator backed by react-i18next. */
export function useT() {
  const { t } = useTranslation()
  return (key: string, params?: Record<string, string | number>) => {
    return t(key, params) as string
  }
}

export function translate(key: string, params?: Record<string, string | number>): string {
  return i18next.t(key, params) as string
}
