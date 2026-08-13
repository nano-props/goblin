import { Copy, RefreshCw } from '@lucide/vue'
import { defineComponent, onMounted, onScopeDispose, ref, watch } from 'vue'
import type { FunctionalComponent, PropType } from 'vue'
import { toast } from 'vue-sonner'
import { SettingsGroup, SettingsList, SettingsRow } from '#/web/components/settings/SettingsPrimitives.tsx'
import { Switch } from '#/web/components/ui/switch.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { getClientBridge } from '#/web/client-bridge.ts'
import { useLanInfoQuery } from '#/web/settings-queries.ts'
import { useLanSettingsController, useLanSettings } from '#/web/runtime-settings-lan.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { fetchServerJson } from '#/web/lib/server-fetch.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import { AccessTokenResponseSchema } from '#/shared/web-bootstrap-response-schema.ts'
import { copyToClipboard } from '#/web/clipboard/clipboard-copy.ts'

/**
 * Settings page for everything related to the embedded / standalone
 * server that the client talks to. Visible in both runtimes:
 *
 * - Both: the current address, the access token with copy support,
 *   token-bearing QR codes, and any active LAN URLs.
 * - Electron only: the `lanEnabled` toggle (the bind address is
 *   owned by the host process) and the `Rotate token` action
 *   (the native host atomically stages the next-start credential).
 *
 * In web / `bun run serve.sh` mode the operator owns the process
 * and the bind address; rotation is an operator-owned file change, so
 * we don't surface those native-host controls. Server-reported LAN
 * addresses remain visible because they are useful in either runtime.
 */
export const WebSettings = defineComponent({
  name: 'WebSettings',
  setup() {
    const t = useT()
    const bridge = getClientBridge()
    const isElectron = bridge.kind() === 'electron'
    const lanSettings = useLanSettings()
    const { data: lanInfo } = useLanInfoQuery()
    const { setLanEnabled } = useLanSettingsController()

    // This is the browser-facing authority the client actually uses for
    // same-origin HTTP and WebSocket traffic. `initialServer` is not the
    // steady-state server configuration: it is populated only for the
    // one-time QR/login handoff, so reading the address from it leaves normal
    // Electron and standalone-web sessions with no value.
    const currentUrl = window.location.origin

    // Intentional high-trust boundary: authenticated settings may read the
    // token for copy/QR; HttpOnly is not an XSS boundary for this renderer.
    const bootstrapToken = getInitialBootstrap().initialServer?.accessToken
    const accessToken = ref<string | null>(bootstrapToken ?? null)
    const accessTokenActivation = ref<'current' | 'after-restart'>('current')
    const accessTokenController = new AbortController()
    onMounted(() => {
      void (async () => {
        if (isElectron) {
          const projectionResult = await bridge.getAccessTokenProjection().then(
            (projection) => ({ ok: true as const, projection }),
            () => ({ ok: false as const }),
          )
          if (!projectionResult.ok) {
            if (!accessTokenController.signal.aborted) toast.error(t('settings.web.token-read-failed'))
            return
          }
          const projection = projectionResult.projection
          if (accessTokenController.signal.aborted) return
          if (accessTokenActivation.value === 'after-restart' && projection.activation === 'current') return
          accessToken.value = projection.accessToken
          accessTokenActivation.value = projection.activation
          return
        }
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

    const handleRotate = async () => {
      if (!isElectron) return
      try {
        const { accessToken: next, activation } = await bridge.rotateAccessToken()
        accessToken.value = next
        accessTokenActivation.value = activation
        toast.success(t('settings.web.token-rotated'))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('settings.web.token-rotate-failed'))
      }
    }

    return () => {
      const currentLanInfo = lanInfo.value
      const lanEnabled = lanSettings.value.lanEnabled
      const lanUrls = currentLanInfo?.lanUrls ?? []
      const accessTokenHintKey =
        accessTokenActivation.value === 'after-restart'
          ? 'settings.web.token-pending-restart-hint'
          : 'settings.web.token-rotation-hint'
      // For each LAN URL, build the QR-target that includes the access
      // token. Scanning the QR opens the page with `?accessToken=...`.
      const qrTargets = accessToken.value
        ? lanUrls.map((url) => `${url.replace(/\/$/, '')}/?accessToken=${encodeURIComponent(accessToken.value ?? '')}`)
        : []
      const showNetworkGroup = isElectron || lanUrls.length > 0
      let lanStatusKey: 'settings.lan.restart-hint' | 'settings.lan.local-only' | null = null
      if (isElectron && currentLanInfo) {
        const lanAccessActive = !isLoopbackHost(currentLanInfo.host)
        if (lanEnabled !== lanAccessActive) lanStatusKey = 'settings.lan.restart-hint'
        else if (!lanAccessActive) lanStatusKey = 'settings.lan.local-only'
      }
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
                    {isElectron ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={handleRotate}
                        aria-label={t('settings.web.token-rotate')}
                      >
                        <RefreshCw class="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                }
              />
            </SettingsList>
            <div class="px-4 py-2 text-sm text-muted-foreground">{t(accessTokenHintKey)}</div>
          </SettingsGroup>

          {showNetworkGroup ? (
            <SettingsGroup label={t('settings.web.lan')}>
              <SettingsList>
                {isElectron ? (
                  <SettingsRow
                    controlId="settings-web-lan-enabled"
                    label={t('settings.lan.enabled')}
                    hint={t('settings.lan.enabled-hint')}
                    control={
                      <Switch
                        id="settings-web-lan-enabled"
                        modelValue={lanEnabled}
                        onUpdate:modelValue={(enabled) => void setLanEnabled(enabled)}
                        aria-label={t('settings.lan.enabled')}
                      />
                    }
                  />
                ) : null}
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
              {lanStatusKey ? <div class="px-4 py-2 text-sm text-muted-foreground">{t(lanStatusKey)}</div> : null}
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

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.')
}

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
