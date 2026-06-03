import { useMutation } from '@tanstack/react-query'
import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
  SettingsSelect,
} from '#/web/components/settings/SettingsPrimitives.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useSettingsStore } from '#/web/stores/settings.ts'
export function SyncSettings() {
  const t = useT()
  const fetchInterval = useSettingsStore((s) => s.fetchIntervalSec)
  const setFetchIntervalSec = useSettingsStore((s) => s.setFetchInterval)
  const setFetchInterval = useMutation({
    mutationFn: (sec: number) => setFetchIntervalSec(sec),
  })
  const intervalOptions: { value: number; labelKey: string }[] = [
    { value: 0, labelKey: 'settings.fetch.off' },
    { value: 30, labelKey: 'settings.fetch.30s' },
    { value: 60, labelKey: 'settings.fetch.1m' },
    { value: 120, labelKey: 'settings.fetch.2m' },
    { value: 180, labelKey: 'settings.fetch.3m' },
    { value: 300, labelKey: 'settings.fetch.5m' },
    { value: 900, labelKey: 'settings.fetch.15m' },
  ]
  const save = (fn: () => Promise<unknown>, label: string) => {
    void fn().catch((err) => console.warn(`[settings] ${label} update failed`, err))
  }

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
              onChange={(v) => save(() => setFetchInterval.mutateAsync(v), 'fetch interval')}
            />
          }
        />
      </SettingsList>
    </SettingsGroup>
  )
}
