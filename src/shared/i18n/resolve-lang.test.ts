import { describe, expect, test } from 'vitest'
import { resolveAutoLang, resolvePreferredLang } from '#/shared/i18n/resolve-lang.ts'

describe('shared i18n language resolution', () => {
  test('returns explicit language preferences unchanged', () => {
    expect(resolvePreferredLang('ja', 'en-US,en;q=0.9')).toBe('ja')
    expect(resolvePreferredLang('ko', null)).toBe('ko')
  })

  test('resolves supported locale prefixes for auto', () => {
    expect(resolveAutoLang('zh-CN')).toBe('zh')
    expect(resolveAutoLang('ko-KR')).toBe('ko')
    expect(resolveAutoLang('ja-JP')).toBe('ja')
    expect(resolveAutoLang('en-US')).toBe('en')
  })

  test('parses accept-language lists with weights for auto', () => {
    expect(resolvePreferredLang('auto', 'fr-FR,ja;q=0.9,en;q=0.8')).toBe('ja')
    expect(resolvePreferredLang('auto', 'de-DE,ko;q=0.7,en;q=0.5')).toBe('ko')
  })

  test('falls back to english when no supported locale is present', () => {
    expect(resolvePreferredLang('auto', 'fr-FR,de;q=0.9')).toBe('en')
    expect(resolvePreferredLang('auto', '')).toBe('en')
    expect(resolvePreferredLang('auto', null)).toBe('en')
  })
})
