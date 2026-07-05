export type AppQuitDrainResult =
  | { ok: true }
  | {
      ok: false
      error: {
        name: string
        message: string
      }
    }

export function errorToAppQuitDrainResult(err: unknown): AppQuitDrainResult {
  if (err instanceof Error) {
    return { ok: false, error: { name: err.name, message: err.message } }
  }
  return { ok: false, error: { name: 'Error', message: String(err) } }
}

export function isAppQuitDrainResult(value: unknown): value is AppQuitDrainResult {
  if (!value || typeof value !== 'object') return false
  if (!('ok' in value)) return false
  if (value.ok === true) return true
  if (value.ok !== false || !('error' in value)) return false
  const error = value.error
  return (
    !!error &&
    typeof error === 'object' &&
    'name' in error &&
    typeof error.name === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}
