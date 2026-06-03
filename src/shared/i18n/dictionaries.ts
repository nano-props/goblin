import { en, type DictKey } from '#/shared/i18n/en.ts'
import { ja } from '#/shared/i18n/ja.ts'
import { ko } from '#/shared/i18n/ko.ts'
import { zh } from '#/shared/i18n/zh.ts'
import type { Lang } from '#/shared/rpc.ts'

export { en, ja, ko, zh }
export type { DictKey } from '#/shared/i18n/en.ts'

export const DICTS: Record<Lang, Record<DictKey, string>> = { en, zh, ko, ja }
