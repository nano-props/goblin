const loggedObjectRenderErrors = new WeakSet<object>()
const loggedPrimitiveRenderErrors = new Set<unknown>()
const MAX_LOGGED_PRIMITIVE_RENDER_ERRORS = 32

export function markReactRenderErrorLogged(error: unknown): boolean {
  const objectLike = (typeof error === 'object' && error !== null) || typeof error === 'function'
  if (!objectLike) {
    if (loggedPrimitiveRenderErrors.has(error)) return true
    if (loggedPrimitiveRenderErrors.size >= MAX_LOGGED_PRIMITIVE_RENDER_ERRORS) loggedPrimitiveRenderErrors.clear()
    loggedPrimitiveRenderErrors.add(error)
    return false
  }
  if (loggedObjectRenderErrors.has(error)) return true
  loggedObjectRenderErrors.add(error)
  return false
}
