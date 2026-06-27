import { getUserSettings } from '#/server/modules/settings-source.ts'
import { resolveI18nSnapshot } from '#/shared/i18n/snapshot.ts'
import type { I18nSnapshot } from '#/shared/api-types.ts'

export async function getServerI18nSnapshot(acceptLanguage?: string | null): Promise<I18nSnapshot> {
  return resolveI18nSnapshot((await getUserSettings()).lang, acceptLanguage)
}
