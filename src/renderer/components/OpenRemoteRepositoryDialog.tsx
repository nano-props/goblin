import { useEffect, useMemo, useState } from 'react'
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
import { rpc } from '#/renderer/rpc.ts'
import { useRemotePathSuggestions } from '#/renderer/hooks/useRemotePathSuggestions.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { RemoteDiagnosticsPanel } from '#/renderer/components/RemoteDiagnosticsPanel.tsx'
import { isResolvableRemotePathInput, isHomeRelativeRemotePath, remoteRepoSessionEntry } from '#/shared/remote-repo.ts'
import type {
  RemoteDiagnosticsResult,
  RemoteRepoTarget,
  SshConfigHost,
} from '#/shared/remote-repo.ts'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OpenRemoteRepositoryDialog({ open, onOpenChange }: Props) {
  const t = useT()
  const [hosts, setHosts] = useState<SshConfigHost[]>([])
  const [hasInclude, setHasInclude] = useState(false)
  const [alias, setAlias] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [target, setTarget] = useState<RemoteRepoTarget | null>(null)
  const [diagnostics, setDiagnostics] = useState<RemoteDiagnosticsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedHost = useMemo(() => hosts.find((item) => item.alias === alias) ?? null, [alias, hosts])
  const pending = loading
  const pathError = remotePathError(remotePath)
  const canSubmit = canSubmitRemoteRepository({ alias, remotePath, pending })
  const pathPreview = formatRemotePathPreview(t, { alias, remotePath, target })
  const pathSuggestions = useRemotePathSuggestions({
    enabled: open && !pending,
    alias,
    remotePath: remotePath.trim() || '/',
    prefix: remotePath,
  })

  function clearResolvedRemoteState() {
    setTarget(null)
    setDiagnostics(null)
  }

  useEffect(() => {
    if (!open) return
    setHosts([])
    setHasInclude(false)
    setAlias('')
    setRemotePath('')
    setTarget(null)
    setDiagnostics(null)
    setLoading(false)
    setError(null)
    let cancelled = false
    void rpc.remote.listSshHosts
      .query()
      .then((result) => {
        if (cancelled) return
        setHosts(result.hosts)
        setHasInclude(result.hasInclude)
        setAlias(result.hasInclude ? '' : (result.hosts[0]?.alias ?? ''))
      })
      .catch((err) => {
        if (!cancelled) setError(formatRemoteDialogError(t, err))
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function resolveCurrentTarget(pathOverride?: string): Promise<RemoteRepoTarget | null> {
    const input = buildRemoteConnectionInput(alias, pathOverride ?? remotePath)
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
      setError(formatRemoteDialogError(t, err))
    } finally {
      setLoading(false)
    }
  }

  async function handleTest() {
    await runConnectionTest()
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
      const openResult = await useReposStore.getState().openRepo(remoteRepoSessionEntry(nextTarget))
      if (!openResult.ok) {
        setError(formatRemoteDialogError(t, openResult.message))
        setLoading(false)
        return
      }
      onOpenChange(false)
    } catch (err) {
      setError(formatRemoteDialogError(t, err))
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
      className="sm:max-w-xl"
      title={t('repo-tabs.open-remote-title')}
      description={t('repo-tabs.open-remote-description')}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <Field className="gap-2">
          <FieldLabel htmlFor="remote-ssh-host">{t('repo-tabs.open-remote-host-alias-label')}</FieldLabel>
          {hasInclude ? (
            <>
              <Input
                id="remote-ssh-host"
                disabled={pending}
                value={alias}
                onChange={(event) => {
                  setAlias(event.target.value)
                  clearResolvedRemoteState()
                }}
                placeholder={hosts[0]?.alias ?? 'my-server'}
                className="h-10 text-sm"
                list={hosts.length > 0 ? 'remote-ssh-host-options' : undefined}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {hosts.length > 0 && (
                <datalist id="remote-ssh-host-options">
                  {hosts.map((item) => (
                    <option key={item.alias} value={item.alias} />
                  ))}
                </datalist>
              )}
              <FieldDescription>{t('repo-tabs.open-remote-include-manual-hint')}</FieldDescription>
            </>
          ) : hosts.length > 0 ? (
            <Select
              value={alias}
              disabled={pending}
              onValueChange={(value) => {
                setAlias(value)
                clearResolvedRemoteState()
              }}
            >
              <SelectTrigger id="remote-ssh-host" className="h-10 w-full text-sm">
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
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              <div>{t('repo-tabs.open-remote-no-ssh-hosts')}</div>
              <div className="mt-1">{t('repo-tabs.open-remote-no-ssh-hosts-help')}</div>
            </div>
          )}
        </Field>

        {selectedHost ? (
          <div className="rounded-md border border-border/60 bg-muted/15 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="truncate font-medium text-foreground">{selectedHost.alias}</span>
              <span className="truncate text-muted-foreground">{selectedHost.hostName ?? selectedHost.alias}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatSshConfigMeta(t, selectedHost)}
            </div>
          </div>
        ) : !hasInclude && hosts.length === 0 ? (
          <FieldDescription>{t('repo-tabs.open-remote-config-required')}</FieldDescription>
        ) : null}

        <Field className="gap-2" data-invalid={pathError.errorKey || (!hasInclude && hosts.length === 0) ? true : undefined}>
          <FieldLabel htmlFor="remote-path">{t('repo-tabs.open-remote-path-label')}</FieldLabel>
          <Input
            id="remote-path"
            autoFocus={hasInclude || hosts.length > 0}
            disabled={pending}
            value={remotePath}
            onChange={(event) => {
              setRemotePath(event.target.value)
              clearResolvedRemoteState()
            }}
            placeholder={t('repo-tabs.open-remote-path-placeholder')}
            className="h-10 font-mono text-sm"
            list={pathSuggestions.length > 0 ? 'open-remote-path-suggestions' : undefined}
          />
          {pathSuggestions.length > 0 && (
            <datalist id="open-remote-path-suggestions">
              {pathSuggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          )}
          <FieldDescription reserveHeight className="whitespace-pre-wrap break-words" title={pathPreview || undefined}>
            {!hasInclude && hosts.length === 0
              ? t('repo-tabs.open-remote-config-required')
              : pathError.errorKey
                ? t(pathError.errorKey)
                : pathPreview}
          </FieldDescription>
        </Field>

        <RemoteDiagnosticsPanel diagnostics={diagnostics} loading={loading} onRetry={() => void handleTest()} />

        {error && <DialogError>{error}</DialogError>}

        <DialogFooter className="gap-2 pt-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={handleCancel}>
            {t('dialog.cancel')}
          </Button>
          <Button type="button" variant="outline" className="min-w-24" disabled={!canSubmit || pending} onClick={() => void handleTest()}>
            {t('repo-tabs.open-remote-test-connection')}
          </Button>
          <Button type="submit" className="min-w-28" disabled={!canSubmit || pending}>
            {t('repo-tabs.open-remote-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

export function remotePathError(value: string): { errorKey: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { errorKey: 'repo-tabs.open-remote-path-required' }
  if (!isValidRemotePathInput(trimmed)) return { errorKey: 'repo-tabs.open-remote-path-absolute' }
  return { errorKey: null }
}

export function canSubmitRemoteRepository(input: {
  alias: string
  remotePath: string
  pending: boolean
}): boolean {
  if (input.pending || remotePathError(input.remotePath).errorKey) return false
  return input.alias.trim().length > 0
}

export function buildRemoteConnectionInput(alias: string, remotePath: string) {
  const cleanPath = remotePath.trim()
  if (remotePathError(cleanPath).errorKey) return null
  const cleanAlias = alias.trim()
  return cleanAlias ? { alias: cleanAlias, remotePath: cleanPath } : null
}

export function formatRemotePathPreview(
  t: (key: string, params?: Record<string, string>) => string,
  input: { alias: string; remotePath: string; target: RemoteRepoTarget | null },
): string {
  const alias = input.target?.alias ?? input.alias.trim()
  const typedPath = input.remotePath.trim()
  if (!alias || !typedPath) return ''
  if (input.target && isHomeRelativeRemotePath(typedPath) && input.target.remotePath !== typedPath) {
    return t('repo-tabs.open-remote-path-preview-expanded', {
      input: `${alias}:${typedPath}`,
      expanded: `${input.target.alias}:${input.target.remotePath}`,
    })
  }
  const path = input.target ? `${input.target.alias}:${input.target.remotePath}` : `${alias}:${typedPath}`
  return t('repo-tabs.open-remote-path-preview', { path })
}

function formatSshConfigMeta(t: (key: string) => string, host: SshConfigHost): string {
  const parts = [
    host.user ? `${t('repo-tabs.open-remote-username-label')}: ${host.user}` : null,
    `${t('repo-tabs.open-remote-port-label')}: ${host.port ?? 22}`,
  ].filter(Boolean)
  return parts.join(' · ')
}

export function formatRemoteDialogError(t: (key: string, params?: Record<string, string>) => string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.startsWith('error.') || message.startsWith('repo-tabs.')) return t(message)
  return message
}

function isValidRemotePathInput(value: string): boolean {
  return isResolvableRemotePathInput(value)
}
