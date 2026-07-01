import { createContext, useContext, type ReactNode } from 'react'
import { useAccessTokenStatus, type AccessTokenStatusState } from '#/web/hooks/useAccessTokenStatus.ts'

const AuthContext = createContext<AccessTokenStatusState | null>(null)

/**
 * Owns the auth lifecycle for the client.
 *
 * Background: `useAccessTokenStatus` carries its own `useState`
 * and probe effect. Before this provider, every consumer (the
 * gate, a future WS subscriber, etc.) called it independently and
 * got a private copy of the state — so the only way for one
 * consumer to learn that another had successfully logged in was
 * a full page reload.
 *
 * This provider centralises the probe behind a single
 * `useAccessTokenStatus` call and exposes the result via context,
 * so any number of descendants can read a consistent auth state
 * and re-read it after a `refresh()` triggered by the gate.
 *
 * Mount it above the router so the gate (and any auth-gated
 * subtree) can consume `useAuth()`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const status = useAccessTokenStatus()
  return <AuthContext value={status}>{children}</AuthContext>
}

export function useAuth(): AccessTokenStatusState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
