import { RotateCw } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { GitHubCliHostState } from '#/shared/api-types.ts'
import { Badge } from '#/web/components/ui/badge.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { SettingsGroup, SettingsList, SettingsRow } from '#/web/components/settings/SettingsPrimitives.tsx'
import { useGitHubCliQuery } from '#/web/settings-queries.ts'
import { useGitHubSettingsController } from '#/web/runtime-settings-github.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { cn } from '#/web/lib/cn.ts'

function hostLoginCommand(host: string): string {
  return host === 'github.com' ? 'gh auth login' : `gh auth login --hostname ${host}`
}

export const GitHubSettings = defineComponent({
  name: 'GitHubSettings',
  setup() {
    const t = useT()
    const { data } = useGitHubCliQuery()
    const { refreshingGitHubCli, refreshGitHubCli } = useGitHubSettingsController()
    return () => {
      const snapshot = data.value
      if (!snapshot) return null
      const githubCliAvailable = snapshot.available
      const hostStates = (Object.values(snapshot.hosts) as GitHubCliHostState[]).sort((a, b) =>
        a.host.localeCompare(b.host),
      )
      const githubCliStatusKey = githubCliAvailable
        ? 'settings.github.status-available'
        : 'settings.github.status-unavailable'
      const githubCliHint = githubCliAvailable
        ? (snapshot.version ?? t('settings.github.hint-installed'))
        : t('settings.github.hint-missing')
      return (
        <SettingsGroup label={t('settings.github.title')} hint={t('settings.github.body')}>
          <SettingsList>
            <SettingsRow
              controlId="settings-github-cli"
              label={
                <span class="inline-flex items-center gap-2">
                  <span>{t('settings.github.cli-label')}</span>
                  <Badge
                    variant={githubCliAvailable ? 'success' : 'outline'}
                    class={cn(githubCliAvailable ? '' : 'text-muted-foreground')}
                  >
                    {t(githubCliStatusKey)}
                  </Badge>
                </span>
              }
              hint={githubCliHint}
              control={
                <div class="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    data-interactive
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (refreshingGitHubCli.value) return
                      void refreshGitHubCli()
                    }}
                    disabled={refreshingGitHubCli.value}
                  >
                    <RotateCw class={cn('size-3', refreshingGitHubCli.value && 'animate-spin')} />
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
                      <span class="inline-flex items-center gap-2">
                        <span class="font-mono text-xs">{hostState.host}</span>
                        <Badge
                          variant={hostState.authenticated ? 'success' : 'outline'}
                          class={cn(hostState.authenticated ? '' : 'text-muted-foreground')}
                        >
                          {t(authStatusKey)}
                        </Badge>
                      </span>
                    }
                    hint={authHint}
                    control={
                      <div class="flex min-w-0 items-center justify-end gap-2 text-xs text-muted-foreground">
                        {hostState.tokenSource ? (
                          <span class="truncate">
                            {t('settings.github.auth-token-source')} {hostState.tokenSource}
                          </span>
                        ) : hostState.logins.length > 1 ? (
                          <span class="truncate">{hostState.logins.join(', ')}</span>
                        ) : null}
                      </div>
                    }
                  />
                )
              })
            ) : (
              <div class="px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
                {t('settings.github.no-hosts')}
              </div>
            )}
          </SettingsList>
        </SettingsGroup>
      )
    }
  },
})
