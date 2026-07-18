import { useEffect, useRef, useState } from 'react'
import { DialogFooter } from '#/web/components/ui/dialog.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { FormDialog } from '#/web/components/ui/form-dialog.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '#/web/components/ui/field.tsx'
import { Input } from '#/web/components/ui/input.tsx'
import { RemotePathSuggestions } from '#/web/components/ui/remote-path-suggestions.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/web/components/ui/select.tsx'
import { useRemotePathSuggestions } from '#/web/hooks/useRemotePathSuggestions.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { getRemoteSshHosts, resolveRemoteRepositoryTarget, testRemoteRepoConnection } from '#/web/remote-client.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { RemoteDiagnosticsPanel } from '#/web/components/RemoteDiagnosticsPanel.tsx'
import { isResolvableRemotePathInput, remoteWorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { cn } from '#/web/lib/cn.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
import type { RemoteDiagnosticsResult, RemoteRepoTarget, SshConfigHost } from '#/shared/remote-repo.ts'
import { isValidSshProfile } from '#/shared/workspace-locator.ts'
interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OpenRemoteWorkspaceDialog({ open, onOpenChange }: Props) {
  const t = useT()
  const compact = useIsCompactUi()
  const navigation = usePrimaryWindowNavigation()
  const [hosts, setHosts] = useState<SshConfigHost[]>([])
  const [hasInclude, setHasInclude] = useState(false)
  const [alias, setAlias] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [diagnostics, setDiagnostics] = useState<RemoteDiagnosticsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const hostInputRef = useRef<HTMLInputElement | null>(null)
  const pathInputRef = useRef<HTMLInputElement | null>(null)
  const pending = loading
  const pathError = remotePathError(remotePath)
  const pathFieldError = remotePath.trim() ? pathError.errorKey : null
  const canSubmit = canSubmitRemoteRepository({ alias, remotePath, pending })
  const error = actionError ?? loadError
  const remotePathSuggestions = useRemotePathSuggestions({
    enabled: open && !pending,
    alias,
    remotePath: remotePath.trim() || '/',
    prefix: remotePath,
  })

  function clearResolvedRemoteState() {
    setDiagnostics(null)
    setActionError(null)
  }

  useEffect(() => {
    if (!open) return
    setHosts([])
    setHasInclude(false)
    setAlias('')
    setRemotePath('')
    setDiagnostics(null)
    setLoading(false)
    setLoadError(null)
    setActionError(null)
    let cancelled = false
    void getRemoteSshHosts()
      .then((result) => {
        if (cancelled) return
        setHosts(result.hosts)
        setHasInclude(result.hasInclude)
        setAlias(result.hasInclude ? '' : (result.hosts[0]?.alias ?? ''))
      })
      .catch((err) => {
        if (!cancelled) setLoadError(formatRemoteDialogError(t, err))
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || pending) return
    if (hasInclude) {
      hostInputRef.current?.focus()
      return
    }
    if (hosts.length > 0) {
      pathInputRef.current?.focus()
    }
  }, [hasInclude, hosts.length, open, pending])

  async function resolveCurrentTarget(pathOverride?: string): Promise<RemoteRepoTarget | null> {
    const input = buildRemoteConnectionInput(alias, pathOverride ?? remotePath)
    if (!input) return null
    return resolveRemoteRepositoryTarget(input)
  }

  async function runConnectionTest(options: { requireCanSubmit?: boolean } = {}) {
    if (options.requireCanSubmit !== false && !canSubmit) return
    setLoading(true)
    setActionError(null)
    try {
      const nextTarget = await resolveCurrentTarget()
      if (!nextTarget) return
      const result = await testRemoteRepoConnection(nextTarget)
      setDiagnostics(result)
    } catch (err) {
      setActionError(formatRemoteDialogError(t, err))
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
    setActionError(null)
    try {
      const nextTarget = await resolveCurrentTarget()
      if (!nextTarget) {
        setLoading(false)
        return
      }
      const needsTest = !diagnostics?.ok || diagnostics.target.id !== nextTarget.id
      if (needsTest) {
        const result = await testRemoteRepoConnection(nextTarget)
        if (!remoteDiagnosticsAllowWorkspaceOpen(result)) {
          setDiagnostics(result)
          setLoading(false)
          return
        }
      }
      const openResult = await useWorkspacesStore.getState().ensureWorkspaceOpen(remoteWorkspaceSessionEntry(nextTarget))
      if (!openResult.ok) {
        setActionError(formatRemoteDialogError(t, openResult.message))
        setLoading(false)
        return
      }
      navigation.activateWorkspace(openResult.workspaceId)
      reportOpenWorkspacePostOpenEffects(openResult, t, { descriptionPrefix: nextTarget.displayName })
      onOpenChange(false)
    } catch (err) {
      setActionError(formatRemoteDialogError(t, err))
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
      title={t('workspace-picker.open-remote-title')}
      description={t('workspace-picker.open-remote-description')}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <Field className="gap-2">
          <FieldLabel htmlFor="remote-ssh-host">{t('workspace-picker.open-remote-host-alias-label')}</FieldLabel>
          {hasInclude ? (
            <>
              <Input
                id="remote-ssh-host"
                ref={hostInputRef}
                autoFocus={hasInclude}
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
              <FieldDescription>{t('workspace-picker.open-remote-include-manual-hint')}</FieldDescription>
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
            <Input
              id="remote-ssh-host"
              disabled
              value=""
              placeholder={hosts[0]?.alias ?? 'my-server'}
              className="h-10 text-sm"
            />
          )}
        </Field>

        <Field className="gap-2" data-invalid={pathFieldError ? true : undefined}>
          <FieldLabel htmlFor="remote-path">{t('workspace-picker.open-remote-path-label')}</FieldLabel>
          <RemotePathSuggestions
            id="remote-path"
            ref={pathInputRef}
            disabled={pending}
            value={remotePath}
            onChange={(next) => {
              setRemotePath(next)
              clearResolvedRemoteState()
            }}
            suggestions={remotePathSuggestions.suggestions}
            isLoading={remotePathSuggestions.isLoading}
            hasFetched={remotePathSuggestions.hasFetched}
            emptyLabel={t('workspace-picker.open-remote-path-no-matches')}
            placeholder={t('workspace-picker.open-remote-path-placeholder')}
            aria-invalid={!!pathFieldError}
          />
          {pathFieldError ? (
            <FieldError reserveHeight>{t(pathFieldError)}</FieldError>
          ) : (
            <FieldDescription reserveHeight aria-hidden />
          )}
        </Field>

        <RemoteDiagnosticsPanel
          diagnostics={diagnostics}
          error={error}
          loading={loading}
          idleText={
            !hasInclude && hosts.length === 0
              ? t('workspace-picker.open-remote-config-required')
              : t('workspace-picker.open-remote-diagnostics-idle-detail')
          }
        />

        <DialogFooter className="gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className={cn(compact && 'w-full')}
            disabled={pending}
            onClick={handleCancel}
          >
            {t('dialog.cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={cn('min-w-24', compact && 'w-full min-w-0')}
            disabled={!canSubmit || pending}
            onClick={() => void handleTest()}
          >
            {t('workspace-picker.open-remote-test-connection')}
          </Button>
          <Button
            type="submit"
            className={cn('min-w-28', compact && 'w-full min-w-0')}
            disabled={!canSubmit || pending}
          >
            {t('workspace-picker.open-remote-confirm')}
          </Button>
        </DialogFooter>
      </form>
    </FormDialog>
  )
}

export function remoteDiagnosticsAllowWorkspaceOpen(result: Pick<RemoteDiagnosticsResult, 'stages'>): boolean {
  return result.stages.some((stage) => stage.name === 'path' && stage.status === 'passed')
}

export function remotePathError(value: string): { errorKey: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { errorKey: 'workspace-picker.open-remote-path-required' }
  if (!isValidRemotePathInput(trimmed)) return { errorKey: 'workspace-picker.open-remote-path-absolute' }
  return { errorKey: null }
}

export function canSubmitRemoteRepository(input: { alias: string; remotePath: string; pending: boolean }): boolean {
  if (input.pending || remotePathError(input.remotePath).errorKey) return false
  return isValidSshProfile(input.alias)
}

export function buildRemoteConnectionInput(alias: string, remotePath: string) {
  const cleanPath = remotePath.trim()
  if (remotePathError(cleanPath).errorKey) return null
  return isValidSshProfile(alias) ? { alias, remotePath: cleanPath } : null
}

export function formatRemoteDialogError(
  t: (key: string, params?: Record<string, string>) => string,
  err: unknown,
): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.startsWith('error.') || message.startsWith('workspace-picker.')) return t(message)
  return message
}

function isValidRemotePathInput(value: string): boolean {
  return isResolvableRemotePathInput(value)
}
