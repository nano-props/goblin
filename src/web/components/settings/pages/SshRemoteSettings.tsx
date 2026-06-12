import {
  SettingsCard,
  SettingsGroup,
  SettingsList,
  SettingsRow,
} from '#/web/components/settings/SettingsPrimitives.tsx'
import { useT } from '#/web/stores/i18n.ts'
export function SshRemoteSettings() {
  const t = useT()

  return (
    <SettingsGroup label={t('settings.ssh.title')} hint={t('settings.ssh.body')}>
      <SettingsList>
        <SettingsRow
          controlId="settings-ssh-config-file"
          label={t('settings.ssh.config-file-label')}
          hint={t('settings.ssh.config-file-hint')}
          control={<span className="font-mono text-[11px] text-muted-foreground">~/.ssh/config</span>}
        />
        <SettingsRow
          controlId="settings-ssh-path-format"
          label={t('settings.ssh.path-format-label')}
          hint={t('settings.ssh.path-format-hint')}
          control={<span className="font-mono text-[11px] text-muted-foreground">/srv/repo · ~/repo</span>}
        />
      </SettingsList>
      <SettingsCard>
        <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-3 font-mono text-[11px] leading-snug text-muted-foreground">
          {t('settings.ssh.example')}
        </pre>
      </SettingsCard>
    </SettingsGroup>
  )
}
