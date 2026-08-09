// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { waitFor } from '@testing-library/vue'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { startI18nProjection, useT } from '#/web/stores/i18n-vue.ts'
import { i18nStore } from '#/web/stores/i18n.ts'

const TranslatedMessage = defineComponent({
  name: 'TranslatedMessage',
  setup() {
    const t = useT()
    return () => <p>{t('status.ready', { count: 2 })}</p>
  },
})

let stopProjection: (() => void) | null = null

beforeEach(() => {
  i18nStore.setState({
    lang: 'en',
    pref: 'auto',
    dict: { 'status.ready': 'Ready: {count}' },
    hydrated: true,
  })
  stopProjection = startI18nProjection()
})

afterEach(() => {
  stopProjection?.()
  stopProjection = null
})

describe('Vue i18n projection', () => {
  test('projects flat server dictionaries and locale changes into Vue renders', async () => {
    const view = renderInJsdom(TranslatedMessage)

    expect(view.getByText('Ready: 2')).toBeTruthy()
    expect(document.documentElement.lang).toBe('en')

    i18nStore.setState({
      lang: 'zh',
      pref: 'zh',
      dict: { 'status.ready': '已就绪：{count}' },
      hydrated: true,
    })

    await waitFor(() => expect(view.getByText('已就绪：2')).toBeTruthy())
    expect(document.documentElement.lang).toBe('zh')
  })
})
