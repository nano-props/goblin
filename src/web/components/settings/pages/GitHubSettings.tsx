import { RotateCw } from 'lucide-react'
import { Badge } from '#/web/components/ui/badge.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { SettingsGroup, SettingsList, SettingsRow } from '#/web/components/settings/SettingsPrimitives.tsx'
import { useGitHubCliQuery } from '#/web/settings-queries.ts'
import { useGitHubSettingsController } from '#/web/runtime-settings-github.ts'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'

function hostLoginCommand(host: string): string {
  return host === 'github.com' ? 'gh auth login' : `gh auth login --hostname ${host}`
}

export function GitHubSettings() {
  const t = useT()
  const { data } = useGitHubCliQuery()
  const { refreshingGitHubCli, refreshGitHubCli } = useGitHubSettingsController()
  if (!data) return null
  const githubCliAvailable = data.available
  const githubCliVersion = data.version
  const githubCliHosts = data.hosts
  const hostStates = Object.values(githubCliHosts).sort((a, b) => a.host.localeCompare(b.host))
  const githubCliStatusKey = githubCliAvailable
    ? 'settings.github.status-available'
    : 'settings.github.status-unavailable'
  const githubCliHint = githubCliAvailable
    ? (githubCliVersion ?? t('settings.github.hint-installed'))
    : t('settings.github.hint-missing')

  return (
    <SettingsGroup label={t('settings.github.title')} hint={t('settings.github.body')}>
      <SettingsList>
        <SettingsRow
          controlId="settings-github-cli"
          label={
            <span className="inline-flex items-center gap-2">
              <span>{t('settings.github.cli-label')}</span>
              <Badge
                variant={githubCliAvailable ? 'success' : 'outline'}
                className={cn(githubCliAvailable ? '' : 'text-muted-foreground')}
              >
                {t(githubCliStatusKey)}
              </Badge>
            </span>
          }
          hint={githubCliHint}
          control={
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                data-interactive
                variant="outline"
                size="sm"
                onClick={() => {
                  if (refreshingGitHubCli) return
                  void refreshGitHubCli()
                }}
                disabled={refreshingGitHubCli}
              >
                <RotateCw className={cn('size-3', refreshingGitHubCli && 'animate-spin')} />
                {t('settings.github.refresh')}
              </Button>
            </div>
          }
        />
        {hostStates.length > 0 ? (
          hostStates.map((hostState) => {
            const authStatusKey = hostState.authenticated
              ? 'settings.github.auth-signed-in'
              : 'settings.github.auth-signed-out'
            const authAccountLabel = t('settings.github.auth-account')
            const authLoginRequiredLabel = t('settings.github.auth-login-required')
            const authHint = hostState.authenticated
              ? hostState.activeLogin
                ? `${authAccountLabel} ${hostState.activeLogin}`
                : t('settings.github.auth-signed-in-hint')
              : `${authLoginRequiredLabel} ${hostLoginCommand(hostState.host)}`
            return (
              <SettingsRow
                key={hostState.host}
                controlId={`settings-github-host-${hostState.host}`}
                label={
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-xs">{hostState.host}</span>
                    <Badge
                      variant={hostState.authenticated ? 'success' : 'outline'}
                      className={cn(hostState.authenticated ? '' : 'text-muted-foreground')}
                    >
                      {t(authStatusKey)}
                    </Badge>
                  </span>
                }
                hint={authHint}
                control={
                  <div className="flex min-w-0 items-center justify-end gap-2 text-xs text-muted-foreground">
                    {hostState.tokenSource ? (
                      <span className="truncate">
                        {t('settings.github.auth-token-source')} {hostState.tokenSource}
                      </span>
                    ) : hostState.logins.length > 1 ? (
                      <span className="truncate">{hostState.logins.join(', ')}</span>
                    ) : null}
                  </div>
                }
              />
            )
          })
        ) : (
          <div className="px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
            {t('settings.github.no-hosts')}
          </div>
        )}
      </SettingsList>
    </SettingsGroup>
  )
}
