import { useState, type FormEvent } from 'react'
import { useAccessTokenStatus } from '#/web/hooks/useAccessTokenStatus.ts'
import { postServerJson } from '#/web/lib/server-fetch.ts'

/**
 * Auth gate for the renderer. Mounts above the app's normal
 * children; on first load calls `/api/whoami` and either passes
 * through (authenticated) or shows a one-field login form
 * (unauthenticated). Embedded renderers have the access token in
 * the bootstrap and never see the form.
 *
 * The form is intentionally minimal — single text input + submit —
 * because the access token is a 25-char base36 string the user is
 * expected to paste from a server log or settings panel. There is
 * no signup, no "forgot token" flow, no rate limit UI; rotate by
 * deleting `<dataDir>/server-token` and restarting.
 */
export function TokenGate({ children }: { children: React.ReactNode }) {
  const status = useAccessTokenStatus()
  if (status.state === 'checking') return <CheckingPlaceholder />
  if (status.state === 'unauthenticated') return <LoginForm onSuccess={status.refresh} />
  return <>{children}</>
}

function CheckingPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <span>Loading…</span>
    </div>
  )
}

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      setError('Enter your access token')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await postServerJson<{ token: string }, { ok: true }>('/api/login', { token: trimmed })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-3 rounded-md border border-border bg-card p-6 text-card-foreground shadow-sm"
      >
        <h1 className="text-lg font-semibold">Enter access token</h1>
        <p className="text-sm text-muted-foreground">
          Paste the access token printed when the server started. The token is saved as an http-only cookie on this
          device.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Access token</span>
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
            placeholder="25-character base36 token"
          />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
