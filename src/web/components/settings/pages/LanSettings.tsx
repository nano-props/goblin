import { SettingsGroup, SettingsList, SettingsRow } from '#/web/components/settings/SettingsPrimitives.tsx'
import { Switch } from '#/web/components/ui/switch.tsx'
import { useLanInfoQuery, useSetLanEnabledMutation, useSettingsSnapshotQuery } from '#/web/settings-queries.ts'
import { useT } from '#/web/stores/i18n.ts'

export function LanSettings() {
  const t = useT()
  const { data: settings } = useSettingsSnapshotQuery()
  const { data: lanInfo } = useLanInfoQuery()
  const setLanEnabled = useSetLanEnabledMutation()

  const lanEnabled = settings?.lanEnabled ?? false
  const lanUrls = lanInfo?.lanUrls ?? []
  const qrCodes = lanInfo?.qrCodes ?? {}

  return (
    <>
      <SettingsGroup label={t('settings.lan.title')}>
        <SettingsList>
          <SettingsRow
            controlId="settings-lan-enabled"
            label={t('settings.lan.enabled')}
            hint={t('settings.lan.enabled-hint')}
            control={
              <Switch
                id="settings-lan-enabled"
                checked={lanEnabled}
                onCheckedChange={(enabled) =>
                  setLanEnabled
                    .mutateAsync(enabled)
                    .catch((err) => console.warn('[settings] lanEnabled update failed', err))
                }
                aria-label={t('settings.lan.enabled')}
              />
            }
          />
        </SettingsList>
        <div className="px-4 py-2 text-sm text-muted-foreground">{t('settings.lan.restart-hint')}</div>
      </SettingsGroup>

      {lanUrls.length > 0 && (
        <SettingsGroup label={t('settings.lan.access')}>
          <div className="space-y-4 px-4 py-3">
            {lanUrls.map((url) => (
              <div key={url} className="flex flex-col items-center gap-2">
                <code className="text-sm text-muted-foreground">{url}</code>
                {qrCodes[url] && (
                  <img src={qrCodes[url]} alt={`QR code for ${url}`} width={180} height={180} className="rounded border" />
                )}
              </div>
            ))}
          </div>
        </SettingsGroup>
      )}
    </>
  )
}
