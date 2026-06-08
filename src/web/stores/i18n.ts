// Renderer-side i18n. Hydrate at boot pulls the dictionary; setPref
// writes through and the broadcast keeps every window in sync.
// React components read translations through react-i18next, while this
// Zustand store keeps the language preference/snapshot available to
// non-hook call sites (Settings controls, ErrorBoundary fallback).

import i18next from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import { create, type StoreApi } from 'zustand'
import type { I18nSnapshot, Lang, LangPref } from '#/shared/rpc.ts'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { getI18nSnapshot, setI18nPref } from '#/web/app-data-client.ts'
import { subscribeSettingsInvalidationRefetch } from '#/web/settings-invalidation-refetch.ts'

export type { Lang, LangPref }
export type Dict = Record<string, string>

interface InitialI18n {
  lang: Lang
  pref: LangPref
  dict: Dict
}

function getInitialI18n(): InitialI18n | null {
  try {
    const raw = getInitialBootstrap().initialI18n
    if (raw && typeof raw === 'object' && 'lang' in raw && 'pref' in raw && 'dict' in raw) {
      return raw as InitialI18n
    }
  } catch {
    // ignore
  }
  return null
}

const initial = getInitialI18n()

void i18next.use(initReactI18next).init({
  lng: initial?.lang ?? 'en',
  fallbackLng: 'en',
  resources: initial ? { [initial.lang]: { translation: { ...initial.dict } } } : { en: { translation: {} } },
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

if (initial && typeof document !== 'undefined') {
  document.documentElement.setAttribute('lang', initial.lang)
}

interface I18nState {
  lang: Lang
  pref: LangPref
  dict: Dict
  hydrate: () => Promise<void>
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
  lang: initial?.lang ?? 'en',
  pref: initial?.pref ?? 'auto',
  dict: initial?.dict ?? {},

  async hydrate() {
    const version = ++hydrateVersion
    const snapshot = await getI18nSnapshot()
    if (version !== hydrateVersion) return
    await commitSnapshot(set, snapshot)
    if (version !== hydrateVersion) return
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
  set((s) => (sameSnapshot(s, snapshot) ? s : { lang: snapshot.lang, pref: snapshot.pref, dict: snapshot.dict }))
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
