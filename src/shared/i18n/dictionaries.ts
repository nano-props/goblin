import { en, type DictKey } from '#/shared/i18n/en.ts'
import { ja } from '#/shared/i18n/ja.ts'
import { ko } from '#/shared/i18n/ko.ts'
import { zh } from '#/shared/i18n/zh.ts'
import type { Lang } from '#/shared/settings.ts'

export const DICTS: Record<Lang, Record<DictKey, string>> = { en, zh, ko, ja }
