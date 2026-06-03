import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/web/components/ui/button.tsx'
import { Switch } from '#/web/components/ui/switch.tsx'
import { SettingsGroup, SettingsList, SettingsRow } from '#/web/components/settings/SettingsPrimitives.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useSettingsStore } from '#/web/stores/settings.ts'
import { terminalBridge } from '#/web/terminal.ts'
export function NotificationSettings() {
  const t = useT()
  const terminalNotificationsEnabled = useSettingsStore((s) => s.terminalNotificationsEnabled)
  const setTerminalNotificationsEnabled = useSettingsStore((s) => s.setTerminalNotificationsEnabled)
  const [testingTerminalNotification, setTestingTerminalNotification] = useState(false)

  const save = (fn: () => Promise<unknown>, label: string) => {
    void fn().catch((err) => console.warn(`[settings] ${label} update failed`, err))
  }

  const testTerminalNotification = () => {
    if (testingTerminalNotification) return
    setTestingTerminalNotification(true)
    void terminalBridge
      .sendTestNotification()
      .then((shown) => {
        if (shown) {
          toast.success(t('settings.terminal-notifications-test-sent'))
        } else {
          toast.error(t('settings.terminal-notifications-test-failed'), {
            description: t('settings.terminal-notifications-test-failed-hint'),
          })
        }
      })
      .catch((err) => {
        console.warn('[settings] terminal notification test failed', err)
        toast.error(t('settings.terminal-notifications-test-failed'), {
          description: t('settings.terminal-notifications-test-failed-hint'),
        })
      })
      .finally(() => {
        setTestingTerminalNotification(false)
      })
  }

  return (
    <SettingsGroup label={t('settings.nav.notifications')}>
      <SettingsList>
        <SettingsRow
          controlId="settings-terminal-notifications"
          label={t('settings.terminal-notifications')}
          hint={t('settings.terminal-notifications-hint')}
          control={
            <Switch
              id="settings-terminal-notifications"
              checked={terminalNotificationsEnabled}
              onCheckedChange={(enabled) =>
                save(() => setTerminalNotificationsEnabled(enabled), 'terminal notifications')
              }
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
              disabled={testingTerminalNotification}
            >
              {t('settings.terminal-notifications-test-button')}
            </Button>
          }
        />
      </SettingsList>
    </SettingsGroup>
  )
}
