import { defineComponent, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '#/web/components/ui/button.tsx'
import { Switch } from '#/web/components/ui/switch.tsx'
import { SettingsGroup, SettingsList, SettingsRow } from '#/web/components/settings/SettingsPrimitives.tsx'
import { useFetchSettingsController, useFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { terminalClient } from '#/web/terminal.ts'
import { getPlatform } from '#/web/stores/host-info.ts'
import { settingsLog } from '#/web/logger.ts'
export const NotificationSettings = defineComponent({
  name: 'NotificationSettings',
  setup() {
    const t = useT()
    const fetchSettings = useFetchSettings()
    const { setTerminalNotificationsEnabled } = useFetchSettingsController()
    const testingTerminalNotification = ref(false)
    // Pick the OS-specific hint at render time so the settings UI doesn't
    // hand a Windows user a macOS-flavored "System Settings → Notifications"
    // path. The client doesn't have `process.platform`; the host-info
    // store carries the value the server returns from `/api/host`.
    const hintKey = notificationsHintKey()

    const testTerminalNotification = () => {
      if (testingTerminalNotification.value) return
      testingTerminalNotification.value = true
      void terminalClient
        .sendTestNotification({
          title: t('settings.terminal-notifications-test-title'),
          body: t('settings.terminal-notifications-test-body'),
        })
        .then((shown) => {
          if (shown) {
            toast.success(t('settings.terminal-notifications-test-sent'))
          } else {
            toast.error(t('settings.terminal-notifications-test-failed'), {
              description: t(hintKey),
            })
          }
        })
        .catch((err) => {
          settingsLog.warn('terminal notification test failed', { err })
          toast.error(t('settings.terminal-notifications-test-failed'), {
            description: t(hintKey),
          })
        })
        .finally(() => {
          testingTerminalNotification.value = false
        })
    }

    return () => (
      <SettingsGroup label={t('settings.nav.notifications')}>
        <SettingsList>
          <SettingsRow
            controlId="settings-terminal-notifications"
            label={t('settings.terminal-notifications')}
            hint={t('settings.terminal-notifications-hint')}
            control={
              <Switch
                id="settings-terminal-notifications"
                modelValue={fetchSettings.value.terminalNotificationsEnabled}
                onUpdate:modelValue={(enabled) => void setTerminalNotificationsEnabled(enabled)}
                aria-label={t('settings.terminal-notifications')}
              />
            }
          />
          <SettingsRow
            controlId="settings-terminal-notifications-test"
            label={t('settings.terminal-notifications-test')}
            hint={t('settings.terminal-notifications-test-hint')}
            control={
              <Button
                id="settings-terminal-notifications-test"
                type="button"
                data-interactive
                size="sm"
                variant="outline"
                onClick={testTerminalNotification}
                disabled={testingTerminalNotification.value}
              >
                {t('settings.terminal-notifications-test-button')}
              </Button>
            }
          />
        </SettingsList>
      </SettingsGroup>
    )
  },
})

/**
 * Pick the OS-specific i18n key for the notification permission hint.
 * Mirrors the variant keys added in shared/i18n/*.ts. The generic key
 * is used on Linux / other Unix-y platforms and on the dev-server
 * preview ('web'), where the OS notification paths don't apply.
 */
function notificationsHintKey():
  | 'settings.terminal-notifications-test-failed-hint.mac'
  | 'settings.terminal-notifications-test-failed-hint.win'
  | 'settings.terminal-notifications-test-failed-hint' {
  const platform = getPlatform()
  if (platform === 'darwin') return 'settings.terminal-notifications-test-failed-hint.mac'
  if (platform === 'win32') return 'settings.terminal-notifications-test-failed-hint.win'
  return 'settings.terminal-notifications-test-failed-hint'
}
