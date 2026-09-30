import { Copy } from '@lucide/vue'
import { defineComponent, onMounted, onScopeDispose, ref, watch } from 'vue'
import type { FunctionalComponent, PropType } from 'vue'
import { toast } from 'vue-sonner'
import { SettingsGroup, SettingsList, SettingsRow } from '#/web/components/settings/SettingsPrimitives.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { getInitialBootstrap } from '#/web/app/bootstrap/initial-snapshot.ts'
import { useLanInfoQuery } from '#/web/settings/queries.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { fetchServerJson } from '#/web/lib/server-fetch.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import { AccessTokenResponseSchema } from '#/shared/web-bootstrap-response-schema.ts'
import { copyToClipboard } from '#/web/clipboard/clipboard-copy.ts'

export const WebSettings = defineComponent({
  name: 'WebSettings',
  setup() {
    const t = useT()
    const { data: lanInfo } = useLanInfoQuery()

    const currentUrl = window.location.origin

    // Intentional high-trust boundary: authenticated settings may read the
    // token for copy/QR; HttpOnly is not an XSS boundary for this renderer.
    const bootstrapToken = getInitialBootstrap().initialServer?.accessToken
    const accessToken = ref<string | null>(bootstrapToken ?? null)
    const accessTokenController = new AbortController()
    onMounted(() => {
      void (async () => {
        if (bootstrapToken) return
        const currentToken = await fetchServerJson('/api/access-token', decodeWith(AccessTokenResponseSchema), {
          signal: accessTokenController.signal,
        }).then(
          ({ accessToken }) => accessToken,
          () => null,
        )
        if (accessTokenController.signal.aborted) return
        accessToken.value = currentToken
      })()
    })
    onScopeDispose(() => accessTokenController.abort('web-settings-unmounted'))

    const copySettingValue = async (
      value: string,
      copiedKey: 'settings.web.token-copied' | 'settings.web.url-copied',
      copyFailedKey: 'settings.web.token-copy-failed' | 'settings.web.url-copy-failed',
    ) => {
      try {
        await copyToClipboard(value)
        toast.success(t(copiedKey))
      } catch {
        toast.error(t(copyFailedKey))
      }
    }

    const handleCopyToken = async () => {
      if (!accessToken.value) return
      await copySettingValue(accessToken.value, 'settings.web.token-copied', 'settings.web.token-copy-failed')
    }

    const handleCopyUrl = (url: string) => {
      return copySettingValue(url, 'settings.web.url-copied', 'settings.web.url-copy-failed')
    }

    return () => {
      const currentLanInfo = lanInfo.value
      const lanUrls = currentLanInfo?.lanUrls ?? []
      const currentAccessToken = accessToken.value
      const qrTargets = currentAccessToken
        ? lanUrls.map((url) => `${url.replace(/\/$/, '')}/?accessToken=${encodeURIComponent(currentAccessToken)}`)
        : []
      const showNetworkGroup = lanUrls.length > 0
      return (
        <>
          <SettingsGroup label={t('settings.web.server')}>
            <SettingsList>
              <SettingsRow
                controlId="settings-web-url"
                label={t('settings.web.url')}
                hint={t('settings.web.url-hint')}
                control={
                  <AddressControl
                    id="settings-web-url"
                    url={currentUrl}
                    copyLabel={t('settings.web.url-copy')}
                    onCopy={handleCopyUrl}
                  />
                }
              />
              <SettingsRow
                controlId="settings-web-token"
                label={t('settings.web.token')}
                hint={t('settings.web.token-hint')}
                control={
                  <div class="flex items-center gap-2">
                    <code id="settings-web-token" class="rounded border bg-muted px-2 py-1 font-mono text-xs">
                      {accessToken.value ?? '…'}
                    </code>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={handleCopyToken}
                      disabled={!accessToken.value}
                      aria-label={t('settings.web.token-copy')}
                    >
                      <Copy class="h-4 w-4" />
                    </Button>
                  </div>
                }
              />
            </SettingsList>
            <div class="px-4 py-2 text-sm text-muted-foreground">{t('settings.web.token-rotation-hint')}</div>
          </SettingsGroup>

          {showNetworkGroup ? (
            <SettingsGroup label={t('settings.web.lan')}>
              <SettingsList>
                {lanUrls.length > 0 ? (
                  <SettingsRow
                    controlId="settings-web-lan-urls"
                    label={t('settings.web.lan-urls')}
                    hint={t('settings.web.lan-urls-hint')}
                    control={
                      <div id="settings-web-lan-urls" class="flex min-w-0 flex-col items-stretch gap-1.5">
                        {lanUrls.map((url) => (
                          <AddressControl
                            key={url}
                            url={url}
                            copyLabel={t('settings.web.url-copy')}
                            onCopy={handleCopyUrl}
                          />
                        ))}
                      </div>
                    }
                  />
                ) : null}
              </SettingsList>
            </SettingsGroup>
          ) : null}

          {qrTargets.length > 0 ? (
            <SettingsGroup label={t('settings.web.qr')}>
              <div class="space-y-4 px-4 py-3">
                {qrTargets.map((target) => (
                  <QrCodeCell key={target} target={target} label={t('settings.web.qr-scan')} />
                ))}
              </div>
            </SettingsGroup>
          ) : null}
        </>
      )
    }
  },
})

interface AddressControlProps {
  id?: string
  url: string
  copyLabel: string
  onCopy: (url: string) => Promise<void>
}

const AddressControl: FunctionalComponent<AddressControlProps> = ({ id, url, copyLabel, onCopy }) => {
  return (
    <div class="flex w-full max-w-96 min-w-0 items-center justify-end gap-1">
      <code id={id} class="min-w-0 flex-1 break-all rounded border bg-muted px-2 py-1 font-mono text-xs">
        {url}
      </code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => void onCopy(url)}
        aria-label={`${copyLabel}: ${url}`}
      >
        <Copy class="h-4 w-4" />
      </Button>
    </div>
  )
}
AddressControl.props = ['id', 'url', 'copyLabel', 'onCopy']
AddressControl.inheritAttrs = false

const QrCodeCell = defineComponent<{ target: string; label: string }>({
  name: 'QrCodeCell',
  props: {
    target: { type: String, required: true },
    label: { type: String, required: true },
  },

  setup(props) {
    const dataUrl = ref<string | null>(null)
    // QR generation is a lazy async resource owned by the current target.
    watch(
      () => props.target,
      (target, _previous, onCleanup) => {
        let current = true
        onCleanup(() => {
          current = false
        })
        dataUrl.value = null
        void (async () => {
          try {
            const { default: QRCode } = await import('qrcode')
            const url = await QRCode.toDataURL(target, { width: 180, margin: 2 })
            if (current) dataUrl.value = url
          } catch {
            if (current) dataUrl.value = null
          }
        })()
      },
      { immediate: true },
    )
    return () => (
      <div class="flex flex-col items-center gap-2">
        <code class="text-sm text-muted-foreground break-all">{props.target}</code>
        {dataUrl.value ? (
          <img src={dataUrl.value} alt={props.label} width={180} height={180} class="rounded border" />
        ) : (
          <div class="h-[180px] w-[180px] animate-pulse rounded border bg-muted" />
        )}
      </div>
    )
  },
})
