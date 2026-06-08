import { describe, expect, test } from 'vitest'
import { DICTS } from '#/shared/i18n/dictionaries.ts'
import { buildI18nSnapshot, resolveI18nSnapshot } from '#/shared/i18n/snapshot.ts'
import type { RpcEvent } from '#/shared/rpc.ts'

describe('i18n snapshot helpers', () => {
  test('builds writable snapshots instead of returning shared dictionary references', () => {
    const snapshot = buildI18nSnapshot({ lang: 'zh', pref: 'zh' })

    expect(snapshot).toMatchObject({ lang: 'zh', pref: 'zh' })
    expect(snapshot.dict).toEqual(DICTS.zh)
    expect(snapshot.dict).not.toBe(DICTS.zh)
  })

  test('resolves snapshots through the shared locale resolver', () => {
    expect(resolveI18nSnapshot('auto', 'zh-CN,zh;q=0.9,en;q=0.8')).toMatchObject({
      lang: 'zh',
      pref: 'auto',
    })
    expect(resolveI18nSnapshot('auto', 'ja-JP,ja;q=0.9,en;q=0.8')).toMatchObject({
      lang: 'ja',
      pref: 'auto',
    })
  })

  test('supports both legacy payload and current snapshot rpc event fields', () => {
    const snapshot = buildI18nSnapshot({ lang: 'ja', pref: 'ja' })
    const legacyEvent = { type: 'i18n-changed', payload: snapshot } satisfies RpcEvent
    const currentEvent = { type: 'i18n-changed', snapshot } satisfies RpcEvent

    expect(legacyEvent.type).toBe('i18n-changed')
    expect(currentEvent.type).toBe('i18n-changed')
  })
})
