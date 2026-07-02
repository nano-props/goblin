import { nanoid } from 'nanoid'

export const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

export function createOpaqueId(prefix: string): string {
  if (!OPAQUE_ID_RE.test(prefix)) throw new Error('invalid opaque id prefix')
  return `${prefix}-${nanoid()}`
}

export function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID_RE.test(value)
}
