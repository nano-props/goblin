import { useEffect, useMemo, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SettingsGroup, SettingsList, SettingsRow } from '#/web/components/settings/SettingsPrimitives.tsx'
import { Switch } from '#/web/components/ui/switch.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { getClientBridge } from '#/web/client-bridge.ts'
import { useLanInfoQuery } from '#/web/settings-queries.ts'
import { useLanSettingsController, useRuntimeLanSettings } from '#/web/runtime-settings-lan.ts'
import { useT } from '#/web/stores/i18n.ts'
import { fetchServerJson } from '#/web/lib/server-fetch.ts'

/**
 * Settings page for everything related to the embedded / standalone
 * server that the client talks to. Visible in both runtimes:
 *
 * - Both: the server URL, the access token (with copy + auto-rotate
 *   QR), and any LAN URLs the server is currently bound to.
 * - Electron only: the `lanEnabled` toggle (the bind address is
 *   owned by the host process) and the `Rotate token` action
 *   (the rotation requires restarting the embedded server, which
 *   only the main process can do).
 *
 * In web / `bun run serve.sh` mode the operator owns the process
 * and the bind address; rotation is a manual delete + restart, so
 * we don't surface the button. The `lanEnabled` field is still
 * echoed as a read-only value because the embedded Electron server
 * writes it before serving the bootstrap, and a curious operator
 * may want to confirm.
 */
export function WebSettings() {
  const t = useT()
  const bridge = getClientBridge()
  const isElectron = bridge.kind() === 'electron'
  const { lanEnabled } = useRuntimeLanSettings()
  const { data: lanInfo } = useLanInfoQuery()
  const { setLanEnabled } = useLanSettingsController()

  const baseUrl = useMemo(() => {
    const server = getInitialBootstrap().initialServer
    if (server?.url) return server.url
    return ''
  }, [])

  // Token display: in embedded mode the value is inlined in the
  // bootstrap; in web mode we round-trip to the auth-gated
  // `/api/access-token` endpoint. Either way the displayed value
  // matches what the server actually authenticates against, so a
  // copy/paste into the gate (or QR scan) works.
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
        const { accessToken } = await fetchServerJson<{ accessToken: string }>('/api/access-token')
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

  const handleCopy = async () => {
    if (!accessToken) return
    try {
      await navigator.clipboard.writeText(accessToken)
      toast.success(t('settings.web.token-copied'))
    } catch {
      toast.error(t('settings.web.token-copy-failed'))
    }
  }

  const handleRotate = async () => {
    if (!isElectron) return
    if (!bridge.rotateAccessToken) return
    try {
      const { accessToken: next } = await bridge.rotateAccessToken()
      setFetchedToken(next)
      // The main process replants the embedded client's auth
      // cookie with the new token before this IPC returns, so the
      // cookie path is now self-consistent. A full reload is still
      // required because the preload's `__GOBLIN_BOOTSTRAP__` was
      // captured once with the OLD token; the client's HTTP
      // client (`server-fetch`) prefers the bootstrap header when
      // present. After the reload the preload runs again, captures
      // the new token via IPC, and the gate stays clear.
      //
      // The URL-token path is no longer required — kept commented
      // as a historical breadcrumb in case the cookie replant
      // regresses and the user re-reports the bug.
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
  const qrTargets = useMemo(() => {
    if (!accessToken) return []
    return lanUrls.map((url) => `${url.replace(/\/$/, '')}/?accessToken=${encodeURIComponent(accessToken)}`)
  }, [lanUrls, accessToken])

  return (
    <>
      <SettingsGroup label={t('settings.web.server')}>
        <SettingsList>
          <SettingsRow
            controlId="settings-web-url"
            label={t('settings.web.url')}
            hint={t('settings.web.url-hint')}
            control={
              <code
                id="settings-web-url"
                className="rounded border bg-muted px-2 py-1 font-mono text-xs"
              >
                {baseUrl || '—'}
              </code>
            }
          />
          <SettingsRow
            controlId="settings-web-token"
            label={t('settings.web.token')}
            hint={t('settings.web.token-hint')}
            control={
              <div className="flex items-center gap-2">
                <code
                  id="settings-web-token"
                  className="rounded border bg-muted px-2 py-1 font-mono text-xs"
                >
                  {accessToken ?? '…'}
                </code>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={handleCopy}
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

      {isElectron ? (
        <SettingsGroup label={t('settings.web.lan')}>
          <SettingsList>
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
          </SettingsList>
          <div className="px-4 py-2 text-sm text-muted-foreground">{t('settings.lan.restart-hint')}</div>
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
