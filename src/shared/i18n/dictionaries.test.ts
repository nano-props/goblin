import { describe, expect, test } from 'vitest'
import { en, ja, ko, zh, type DictKey } from '#/shared/i18n/dictionaries.ts'

const dicts = { en, zh, ko, ja } as const

function placeholders(value: string): string[] {
  return Array.from(new Set(Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]!).sort()))
}

function componentTags(value: string): string[] {
  return Array.from(new Set(Array.from(value.matchAll(/<\/?([A-Za-z][\w-]*)>/g), (match) => match[1]!).sort()))
}

describe('i18n dictionaries', () => {
  test('does not contain empty or whitespace-only values', () => {
    for (const [lang, dict] of Object.entries(dicts)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `${lang}.${key}`).not.toBe('')
      }
    }
  })

  test('keeps placeholders and rich-text component tags aligned with English', () => {
    const keys = Object.keys(en) as DictKey[]
    for (const lang of ['zh', 'ko', 'ja'] as const) {
      for (const key of keys) {
        expect(placeholders(dicts[lang][key]), `${lang}.${key} placeholders`).toEqual(placeholders(en[key]))
        expect(componentTags(dicts[lang][key]), `${lang}.${key} component tags`).toEqual(componentTags(en[key]))
      }
    }
  })

  test('localizes menu and remote repository copy for non-English dictionaries', () => {
    expect(zh['menu.file.open-remote-repo']).toBe('打开远程仓库…')
    expect(ko['menu.file.open-remote-repo']).toBe('원격 리포지토리 열기…')
    expect(ja['menu.file.open-remote-repo']).toBe('リモートリポジトリを開く…')

    expect(zh['repo-tabs.open-remote']).toBe('打开远程仓库…')
    expect(ko['repo-tabs.open-remote']).toBe('원격 리포지토리 열기…')
    expect(ja['repo-tabs.open-remote']).toBe('リモートリポジトリを開く…')

    expect(ko['repo-tabs.open-remote-host-label']).toBe('호스트')
    expect(ja['repo-tabs.open-remote-host-label']).toBe('ホスト')
    expect(ko['repo-tabs.open-remote-port-label']).toBe('포트')
    expect(ja['repo-tabs.open-remote-port-label']).toBe('ポート')
    expect(ko['repo-tabs.open-remote-username-label']).toBe('사용자 이름')
    expect(ja['repo-tabs.open-remote-username-label']).toBe('ユーザー名')
    expect(ko['repo-tabs.open-remote-private-key-label']).toBe('개인 키')
    expect(ja['repo-tabs.open-remote-private-key-label']).toBe('秘密鍵')
    expect(ko['repo-tabs.open-remote-private-key-choose']).toBe('개인 키 선택')
    expect(ja['repo-tabs.open-remote-private-key-choose']).toBe('秘密鍵を選択')
    expect(ko['repo-tabs.open-remote-path-label']).toBe('원격 경로')
    expect(ja['repo-tabs.open-remote-path-label']).toBe('リモートパス')
  })
})
