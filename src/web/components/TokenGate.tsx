import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '#/web/auth/AuthProvider.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { postServerJson } from '#/web/lib/server-fetch.ts'

/**
 * Auth gate for the renderer. Mounts above the app's normal
 * children; reads the shared auth state from `useAuth()` and
 * either passes through (authenticated) or shows a one-field
 * login form (unauthenticated). Embedded renderers have the
 * access token in the bootstrap and never see the form.
 *
 * The form is intentionally minimal — single text input + submit —
 * because the access token is a 25-char base36 string the user is
 * expected to paste from a server log or settings panel. There is
 * no signup, no "forgot token" flow, no rate limit UI; rotate by
 * deleting the access-token file under `app.getPath('userData')`
 * (see `ACCESS_TOKEN_FILE_NAME`) and restarting.
 *
 * Mounted children only exist in the React tree once auth has
 * resolved to `authenticated`, so any side effects (WebSocket
 * subscribers, periodic polls) declared inside this subtree
 * run only after the user has a valid session. This is what
 * keeps the server log quiet on first load.
 *
 * Note: we deliberately do NOT block on i18n hydration here.
 * The i18n store's `hydrate()` is async and races with the
 * preload's bootstrap-seed IPC; gating on it can leave the
 * user stuck on the "checking" placeholder if the bootstrap
 * is empty for any reason (e.g. the embedded server failed to
 * start). The 200ms flash of raw `auth.gate.title` is the
 * cheaper trade-off.
 */
export function TokenGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.state === 'checking') return <CheckingPlaceholder />
  if (auth.state === 'unauthenticated') return <LoginForm onSuccess={auth.refresh} />
  return <>{children}</>
}

function CheckingPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <span>…</span>
    </div>
  )
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useT()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      setError(t('auth.gate.error-empty'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await postServerJson<{ token: string }, { ok: true }>('/api/login', { token: trimmed })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.gate.error-failed'))
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-3 rounded-md border border-border bg-card p-6 text-card-foreground shadow-sm"
      >
        <h1 className="text-lg font-semibold">{t('auth.gate.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('auth.gate.description')}</p>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('auth.gate.token-label')}</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
            className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
            placeholder={t('auth.gate.token-placeholder')}
          />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {submitting ? t('auth.gate.signing-in') : t('auth.gate.sign-in')}
        </button>
      </form>
    </div>
  )
}
