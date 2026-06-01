import { useEffect, useMemo, useState } from 'react'
import { FileKey } from 'lucide-react'
import { DialogFooter } from '#/renderer/components/ui/dialog.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { DialogError } from '#/renderer/components/ui/dialog-error.tsx'
import { FormDialog } from '#/renderer/components/ui/form-dialog.tsx'
import { Field, FieldDescription, FieldLabel } from '#/renderer/components/ui/field.tsx'
import { Input } from '#/renderer/components/ui/input.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/renderer/components/ui/select.tsx'
import { ToggleGroup, ToggleGroupItem } from '#/renderer/components/ui/toggle-group.tsx'
import { rpc } from '#/renderer/rpc.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { RemoteDiagnosticsPanel } from '#/renderer/components/RemoteDiagnosticsPanel.tsx'
import { isAbsoluteRemotePath } from '#/shared/remote-repo.ts'
import type {
  RemoteDiagnosticsResult,
  RemoteRepoTarget,
  SshConfigHost,
} from '#/shared/remote-repo.ts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export type AddRemoteMode = 'config' | 'manual'

const DEFAULT_MANUAL_USER = 'root'
const DEFAULT_MANUAL_PORT = '22'

export function OpenRemoteRepositoryDialog({ open, onOpenChange }: Props) {
  const t = useT()
  const [hosts, setHosts] = useState<SshConfigHost[]>([])
  const [mode, setMode] = useState<AddRemoteMode>('manual')
  const [alias, setAlias] = useState('')
  const [host, setHost] = useState('')
  const [user, setUser] = useState(DEFAULT_MANUAL_USER)
  const [port, setPort] = useState(DEFAULT_MANUAL_PORT)
  const [identityFile, setIdentityFile] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [target, setTarget] = useState<RemoteRepoTarget | null>(null)
  const [diagnostics, setDiagnostics] = useState<RemoteDiagnosticsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const portResult = useMemo(() => parseRemotePort(port), [port])
  const pending = loading
  const pathError = remotePathError(remotePath)
  const canSubmit = canSubmitRemoteRepository({
    mode,
    alias,
    host,
    user,
    remotePath,
    portError: portResult.errorKey,
    pending,
  })

  function clearResolvedRemoteState() {
    setTarget(null)
    setDiagnostics(null)
  }

  useEffect(() => {
    if (!open) return
    setHosts([])
    setMode('manual')
    setAlias('')
    setHost('')
    setUser(DEFAULT_MANUAL_USER)
    setPort(DEFAULT_MANUAL_PORT)
    setIdentityFile('')
    setRemotePath('')
    setTarget(null)
    setDiagnostics(null)
    setLoading(false)
    setError(null)
    let cancelled = false
    void rpc.remote.listSshHosts
      .query()
      .then((items) => {
        if (cancelled) return
        setHosts(items)
        if (items.length > 0) {
          setMode('config')
          setAlias(items[0]?.alias ?? '')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function resolveCurrentTarget(pathOverride?: string): Promise<RemoteRepoTarget | null> {
    const input = buildRemoteConnectionInput(
      mode,
      alias,
      host,
      user,
      portResult.port,
      pathOverride ?? remotePath,
      identityFile,
    )
    if (!input) return null
    const resolved = await rpc.remote.resolveTarget.query(input)
    setTarget(resolved.target)
    return resolved.target
  }

  async function runConnectionTest(options: { requireCanSubmit?: boolean } = {}) {
    if (options.requireCanSubmit !== false && !canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const nextTarget = await resolveCurrentTarget()
      if (!nextTarget) return
      const result = await rpc.remote.testRepository.query({ target: nextTarget })
      setDiagnostics(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleTest() {
    await runConnectionTest()
  }

  async function handleIdentityFileBrowse() {
    setError(null)
    try {
      const selectedPath = await rpc.remote.identityFileDialog.mutate()
      if (!selectedPath) return
      setIdentityFile(selectedPath)
      clearResolvedRemoteState()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const nextTarget = await resolveCurrentTarget()
      if (!nextTarget) return
      const needsTest = !diagnostics?.ok || diagnostics.target.id !== nextTarget.id
      if (needsTest) {
        const result = await rpc.remote.testRepository.query({ target: nextTarget })
        if (!result.ok) {
          setDiagnostics(result)
          setLoading(false)
          return
        }
      }
      const openResult = await useReposStore.getState().openRepo(nextTarget.id)
      if (!openResult.ok) {
        setError(t(openResult.message))
        setLoading(false)
        return
      }
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function handleCancel() {
    if (!pending) onOpenChange(false)
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) handleCancel()
      }}
      showCloseButton={!pending}
      title={t('repo-tabs.open-remote-title')}
      description={t('repo-tabs.open-remote-description')}
    >
      <form
        className="space-y-0"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <Field>
          <FieldDescription>{t('repo-tabs.open-remote-connect-via-ssh')}</FieldDescription>
        </Field>

        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => {
            if (!next) return
            const nextMode = next as AddRemoteMode
            setMode(nextMode)
            if (nextMode === 'config') {
              setAlias((currentAlias) =>
                hosts.some((item) => item.alias === currentAlias) ? currentAlias : (hosts[0]?.alias ?? ''),
              )
            }
            clearResolvedRemoteState()
          }}
          variant="outline"
          size="sm"
          className="w-full"
        >
          <ToggleGroupItem value="config" disabled={pending || hosts.length === 0} className="flex-1 text-xs">
            {t('repo-tabs.open-remote-ssh-config')}
          </ToggleGroupItem>
          <ToggleGroupItem value="manual" disabled={pending} className="flex-1 text-xs">
            {t('repo-tabs.open-remote-manual')}
          </ToggleGroupItem>
        </ToggleGroup>

        {mode === 'config' ? (
          <Field>
            <FieldLabel htmlFor="remote-ssh-host">{t('repo-tabs.open-remote-ssh-config')}</FieldLabel>
            {hosts.length > 0 ? (
              <Select
                value={alias}
                disabled={pending}
                onValueChange={(value) => {
                  setAlias(value)
                  clearResolvedRemoteState()
                }}
              >
                <SelectTrigger id="remote-ssh-host" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hosts.map((item) => (
                    <SelectItem key={item.alias} value={item.alias}>
                      {item.alias}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                {t('repo-tabs.open-remote-no-ssh-hosts')}
              </div>
            )}
            <FieldDescription reserveHeight aria-hidden />
          </Field>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor="remote-host">{t('repo-tabs.open-remote-host-label')}</FieldLabel>
              <Input
                id="remote-host"
                autoFocus
                disabled={pending}
                value={host}
                onChange={(event) => {
                  setHost(event.target.value)
                  clearResolvedRemoteState()
                }}
                placeholder={t('repo-tabs.open-remote-host-placeholder')}
                className="font-mono text-xs"
              />
              <FieldDescription reserveHeight aria-hidden />
            </Field>
            <Field>
              <FieldLabel htmlFor="remote-user">{t('repo-tabs.open-remote-username-label')}</FieldLabel>
              <Input
                id="remote-user"
                disabled={pending}
                value={user}
                onChange={(event) => {
                  setUser(event.target.value)
                  clearResolvedRemoteState()
                }}
                className="font-mono text-xs"
              />
              <FieldDescription reserveHeight aria-hidden />
            </Field>
            <Field>
              <FieldLabel htmlFor="remote-port">{t('repo-tabs.open-remote-port-label')}</FieldLabel>
              <Input
                id="remote-port"
                disabled={pending}
                value={port}
                onChange={(event) => {
                  setPort(event.target.value)
                  clearResolvedRemoteState()
                }}
                className="font-mono text-xs"
              />
              <FieldDescription reserveHeight aria-hidden />
            </Field>
          </>
        )}

        <Field>
          <FieldLabel htmlFor="remote-private-key">{t('repo-tabs.open-remote-private-key-label')}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="remote-private-key"
              value={identityFile}
              disabled={pending}
              placeholder="~/.ssh/id_ed25519"
              onChange={(event) => {
                setIdentityFile(event.target.value)
                clearResolvedRemoteState()
              }}
              className="min-w-0 flex-1 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={pending}
              aria-label={t('repo-tabs.open-remote-private-key-choose')}
              title={t('repo-tabs.open-remote-private-key-choose')}
              onClick={() => void handleIdentityFileBrowse()}
            >
              <FileKey className="h-4 w-4" />
            </Button>
          </div>
          <FieldDescription reserveHeight>{t('repo-tabs.open-remote-private-key-hint')}</FieldDescription>
        </Field>

        <Field data-invalid={pathError.errorKey ? true : undefined}>
          <FieldLabel htmlFor="remote-path">{t('repo-tabs.open-remote-path-label')}</FieldLabel>
          <Input
            id="remote-path"
            disabled={pending}
            value={remotePath}
            onChange={(event) => {
              setRemotePath(event.target.value)
              clearResolvedRemoteState()
            }}
            placeholder={t('repo-tabs.open-remote-path-placeholder')}
            className="font-mono text-xs"
          />
          <FieldDescription reserveHeight>
            {portResult.errorKey
              ? t(portResult.errorKey)
              : pathError.errorKey
                ? t(pathError.errorKey)
                : target
                  ? target.id
                  : ''}
          </FieldDescription>
        </Field>

        <RemoteDiagnosticsPanel diagnostics={diagnostics} loading={loading} onRetry={() => void handleTest()} />

        {error && <DialogError>{error}</DialogError>}

        <DialogFooter className="pt-4">
          <Button type="button" variant="ghost" disabled={pending} onClick={handleCancel}>
            {t('dialog.cancel')}
          </Button>
          <Button type="button" variant="outline" disabled={!canSubmit || pending} onClick={() => void handleTest()}>
            {t('repo-tabs.open-remote-test-connection')}
          </Button>
          <Button type="submit" disabled={!canSubmit || pending}>
            {t('repo-tabs.open-remote-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

export function parseRemotePort(value: string): { port?: number; errorKey: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { errorKey: null }
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { errorKey: 'repo-tabs.open-remote-port-error' }
  return { port, errorKey: null }
}

export function remotePathError(value: string): { errorKey: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { errorKey: 'repo-tabs.open-remote-path-required' }
  if (!isAbsoluteRemotePath(trimmed)) return { errorKey: 'repo-tabs.open-remote-path-absolute' }
  return { errorKey: null }
}

export function canSubmitRemoteRepository(input: {
  mode: AddRemoteMode
  alias: string
  host: string
  user: string
  remotePath: string
  portError: string | null
  pending: boolean
}): boolean {
  if (input.pending || input.portError || remotePathError(input.remotePath).errorKey) return false
  if (input.mode === 'config') return input.alias.trim().length > 0
  return input.host.trim().length > 0 && input.user.trim().length > 0
}

export function buildRemoteConnectionInput(
  mode: AddRemoteMode,
  alias: string,
  host: string,
  user: string,
  port: number | undefined,
  remotePath: string,
  identityFile: string = '',
) {
  const cleanPath = remotePath.trim()
  if (remotePathError(cleanPath).errorKey) return null
  const cleanIdentityFile = identityFile.trim()
  const auth = cleanIdentityFile ? { identityFile: cleanIdentityFile } : {}
  if (mode === 'config') {
    const cleanAlias = alias.trim()
    return cleanAlias ? { mode: 'config' as const, alias: cleanAlias, remotePath: cleanPath, ...auth } : null
  }
  const cleanHost = host.trim()
  const cleanUser = user.trim()
  if (!cleanHost || !cleanUser) return null
  return port
    ? { mode: 'manual' as const, host: cleanHost, user: cleanUser, port, remotePath: cleanPath, ...auth }
    : { mode: 'manual' as const, host: cleanHost, user: cleanUser, remotePath: cleanPath, ...auth }
}
