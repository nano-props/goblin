import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SettingsGroup, SettingsList, SettingsRow } from '#/web/components/settings/SettingsPrimitives.tsx'
import { Switch } from '#/web/components/ui/switch.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { getClientBridge } from '#/web/client-bridge.ts'
import { useLanInfoQuery } from '#/web/settings-queries.ts'
import { useLanSettingsController, useLanSettings } from '#/web/runtime-settings-lan.ts'
import { useT } from '#/web/stores/i18n.ts'
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
 *   (the rotation requires restarting the embedded server, which
 *   only the native host can do).
 *
 * In web / `bun run serve.sh` mode the operator owns the process
 * and the bind address; rotation is a manual delete + restart, so
 * we don't surface those native-host controls. Server-reported LAN
 * addresses remain visible because they are useful in either runtime.
 */
export function WebSettings() {
  const t = useT()
  const bridge = getClientBridge()
  const isElectron = bridge.kind() === 'electron'
  const { lanEnabled } = useLanSettings()
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
  const [fetchedToken, setFetchedToken] = useState<string | null>(null)
  useEffect(() => {
    if (bootstrapToken) {
      setFetchedToken(bootstrapToken)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { accessToken } = await fetchServerJson('/api/access-token', decodeWith(AccessTokenResponseSchema))
        if (!cancelled) setFetchedToken(accessToken)
      } catch {
        if (!cancelled) setFetchedToken(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootstrapToken])
  const accessToken = fetchedToken

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
    if (!accessToken) return
    await copySettingValue(accessToken, 'settings.web.token-copied', 'settings.web.token-copy-failed')
  }

  const handleCopyUrl = (url: string) => {
    return copySettingValue(url, 'settings.web.url-copied', 'settings.web.url-copy-failed')
  }

  const handleRotate = async () => {
    if (!isElectron || !bridge.rotateAccessToken) return
    try {
      const { accessToken: next } = await bridge.rotateAccessToken()
      setFetchedToken(next)
      // The native host replants the embedded client's auth
      // cookie with the new token before this IPC returns, so the
      // cookie path is now self-consistent. A full reload is still
      // required because the preload's `__GOBLIN_BOOTSTRAP__` was
      // captured once with the OLD token; the client's HTTP
      // client (`server-fetch`) prefers the bootstrap header when
      // present. After the reload the preload runs again, captures
      // the new token via IPC, and the gate stays clear.
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.web.token-rotate-failed'))
    }
  }

  const lanUrls = lanInfo?.lanUrls ?? []
  // For each LAN URL, build the QR-target that includes the access
  // token. Scanning the QR opens the page with `?accessToken=...`;
  // the page consumes it on first load (POST `/api/login` →
  // Set-Cookie → strip from URL) and the user is logged in.
  const qrTargets = accessToken
    ? lanUrls.map((url) => `${url.replace(/\/$/, '')}/?accessToken=${encodeURIComponent(accessToken)}`)
    : []
  const showNetworkGroup = isElectron || lanUrls.length > 0
  let lanStatusKey: 'settings.lan.restart-hint' | 'settings.lan.local-only' | null = null
  if (isElectron && lanInfo) {
    const lanAccessActive = !isLoopbackHost(lanInfo.host)
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
              <div className="flex items-center gap-2">
                <code id="settings-web-token" className="rounded border bg-muted px-2 py-1 font-mono text-xs">
                  {accessToken ?? '…'}
                </code>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={handleCopyToken}
                  disabled={!accessToken}
                  aria-label={t('settings.web.token-copy')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                {isElectron ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={handleRotate}
                    aria-label={t('settings.web.token-rotate')}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            }
          />
        </SettingsList>
        <div className="px-4 py-2 text-sm text-muted-foreground">{t('settings.web.token-rotation-hint')}</div>
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
                    checked={lanEnabled}
                    onCheckedChange={(enabled) => void setLanEnabled(enabled)}
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
                  <div id="settings-web-lan-urls" className="flex min-w-0 flex-col items-stretch gap-1.5">
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
          {lanStatusKey ? <div className="px-4 py-2 text-sm text-muted-foreground">{t(lanStatusKey)}</div> : null}
        </SettingsGroup>
      ) : null}

      {qrTargets.length > 0 ? (
        <SettingsGroup label={t('settings.web.qr')}>
          <div className="space-y-4 px-4 py-3">
            {qrTargets.map((target) => (
              <QrCodeCell key={target} target={target} label={t('settings.web.qr-scan')} />
            ))}
          </div>
        </SettingsGroup>
      ) : null}
    </>
  )
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.')
}

function AddressControl({
  id,
  url,
  copyLabel,
  onCopy,
}: {
  id?: string
  url: string
  copyLabel: string
  onCopy: (url: string) => Promise<void>
}) {
  return (
    <div className="flex w-full max-w-96 min-w-0 items-center justify-end gap-1">
      <code id={id} className="min-w-0 flex-1 break-all rounded border bg-muted px-2 py-1 font-mono text-xs">
        {url}
      </code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => void onCopy(url)}
        aria-label={`${copyLabel}: ${url}`}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  )
}

function QrCodeCell({ target, label }: { target: string; label: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { default: QRCode } = await import('qrcode')
        const url = await QRCode.toDataURL(target, { width: 180, margin: 2 })
        if (!cancelled) setDataUrl(url)
      } catch {
        if (!cancelled) setDataUrl(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [target])
  return (
    <div className="flex flex-col items-center gap-2">
      <code className="text-sm text-muted-foreground break-all">{target}</code>
      {dataUrl ? (
        <img src={dataUrl} alt={label} width={180} height={180} className="rounded border" />
      ) : (
        <div className="h-[180px] w-[180px] animate-pulse rounded border bg-muted" />
      )}
    </div>
  )
}
