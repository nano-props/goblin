import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
  SettingsSelect,
} from '#/web/components/settings/SettingsPrimitives.tsx'
import { useFetchSettingsController, useRuntimeFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { useT } from '#/web/stores/i18n.ts'
export function SyncSettings() {
  const t = useT()
  const { fetchIntervalSec: fetchInterval } = useRuntimeFetchSettings()
  const { setFetchInterval } = useFetchSettingsController()
  const intervalOptions: { value: number; labelKey: string }[] = [
    { value: 0, labelKey: 'settings.fetch.off' },
    { value: 30, labelKey: 'settings.fetch.30s' },
    { value: 60, labelKey: 'settings.fetch.1m' },
    { value: 120, labelKey: 'settings.fetch.2m' },
    { value: 180, labelKey: 'settings.fetch.3m' },
    { value: 300, labelKey: 'settings.fetch.5m' },
    { value: 900, labelKey: 'settings.fetch.15m' },
  ]
  return (
    <SettingsGroup label={t('settings.group.sync')}>
      <SettingsList>
        <SettingsRow
          controlId="settings-fetch"
          label={t('settings.fetch')}
          hint={t('settings.fetch-hint')}
          control={
            <SettingsSelect
              id="settings-fetch"
              value={fetchInterval}
              options={intervalOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              onChange={(v) => void setFetchInterval(v)}
            />
          }
        />
      </SettingsList>
    </SettingsGroup>
  )
}
