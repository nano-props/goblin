import { formatDistanceStrict, isValid, parseISO } from 'date-fns'
import type { Locale } from 'date-fns/locale'
import { enUS } from 'date-fns/locale/en-US'
import { ja } from 'date-fns/locale/ja'
import { ko } from 'date-fns/locale/ko'
import { zhCN } from 'date-fns/locale/zh-CN'
import type { Lang } from '#/shared/rpc.ts'
const LOCALES: Record<Lang, Locale> = {
  en: enUS,
  zh: zhCN,
  ko,
  ja,
}

export function formatRelativeTime(value: string, lang: Lang, baseDate: Date = new Date()): string {
  const date = parseISO(value)
  if (!isValid(date)) return value
  return formatDistanceStrict(date, baseDate, { addSuffix: true, locale: LOCALES[lang] })
}
