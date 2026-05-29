// Renderer-side i18n. Hydrate at boot pulls the dictionary; setPref
// writes through and the broadcast keeps every window in sync.
// React components read translations through react-i18next, while this
// Zustand store keeps the language preference/snapshot available to
// non-hook call sites (Settings controls, ErrorBoundary fallback).

import i18next from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import { create, type StoreApi } from 'zustand'
import type { I18nPayload, Lang, LangPref } from '#/shared/rpc.ts'
import { onRpcEventType, rpc } from '#/renderer/rpc.ts'

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
  hydrate: () => Promise<void>
  setPref: (pref: LangPref) => Promise<void>
}

type I18nSet = StoreApi<I18nState>['setState']

let unsubscribe: (() => void) | null = null
let hydrateVersion = 0
let payloadQueue = Promise.resolve()

function clearI18nSubscription() {
  unsubscribe?.()
  unsubscribe = null
}

export const useI18nStore = create<I18nState>((set) => ({
  lang: 'en',
  pref: 'auto',
  dict: {},

  async hydrate() {
    const version = ++hydrateVersion
    const payload = await rpc.i18n.get.query()
    if (version !== hydrateVersion) return
    await commitPayload(set, payload)
    if (version !== hydrateVersion) return
    const nextUnsubscribe = onRpcEventType('i18n-changed', (event) => {
      void commitPayload(set, event.payload).catch((err) => {
        console.warn('[i18n] change failed', err)
      })
    })
    if (version !== hydrateVersion) {
      nextUnsubscribe()
      return
    }
    clearI18nSubscription()
    unsubscribe = nextUnsubscribe
  },

  async setPref(pref) {
    const payload = await rpc.i18n.setPref.mutate({ pref })
    if (payload) {
      await commitPayload(set, payload)
    }
  },
}))

function commitPayload(set: I18nSet, payload: I18nPayload): Promise<void> {
  const work = payloadQueue.then(() => commitPayloadNow(set, payload))
  payloadQueue = work.catch(() => {})
  return work
}

async function commitPayloadNow(set: I18nSet, payload: I18nPayload): Promise<void> {
  const current = useI18nStore.getState()
  if (samePayload(current, payload)) return
  await applyPayload(payload)
  set((s) => (samePayload(s, payload) ? s : { lang: payload.lang, pref: payload.pref, dict: payload.dict }))
  document.documentElement.setAttribute('lang', payload.lang)
}

function samePayload(state: Pick<I18nState, 'lang' | 'pref' | 'dict'>, payload: I18nPayload): boolean {
  if (state.lang !== payload.lang || state.pref !== payload.pref) return false
  const stateKeys = Object.keys(state.dict)
  const payloadKeys = Object.keys(payload.dict)
  if (stateKeys.length !== payloadKeys.length) return false
  return stateKeys.every((key) => state.dict[key] === payload.dict[key])
}

async function applyPayload(payload: { lang: Lang; dict: Dict }): Promise<void> {
  i18next.addResourceBundle(payload.lang, 'translation', payload.dict, true, true)
  await i18next.changeLanguage(payload.lang)
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
