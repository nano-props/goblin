import { isRegisteredClientSurfaceId } from '#/main/client-surface-registry.ts'

interface TrustedWebContentsHandle {
  readonly id: number
  once(event: 'destroyed', listener: () => void): unknown
}

interface TrustedIpcEvent {
  sender: { readonly id: number }
  senderFrame: { readonly url: string } | null
}

const explicitlyTrustedWebContentsIds = new Set<number>()
const trustedAppUrls = new Set<string>()
const trustedAppUrlsByWebContentsId = new Map<number, Set<string>>()

export function registerTrustedWebContents(webContents: TrustedWebContentsHandle): void {
  explicitlyTrustedWebContentsIds.add(webContents.id)
  webContents.once('destroyed', () => {
    explicitlyTrustedWebContentsIds.delete(webContents.id)
    trustedAppUrlsByWebContentsId.delete(webContents.id)
  })
}

export function registerTrustedAppUrl(value: string): void {
  const normalized = normalizeTrustedAppUrl(value)
  if (normalized) trustedAppUrls.add(normalized)
}

export function allowTrustedAppUrlForWebContents(webContents: TrustedWebContentsHandle, value: string): void {
  const normalized = normalizeTrustedAppUrl(value)
  if (!normalized) return
  const trustedUrls = trustedAppUrlsByWebContentsId.get(webContents.id) ?? new Set<string>()
  trustedUrls.add(normalized)
  trustedAppUrlsByWebContentsId.set(webContents.id, trustedUrls)
  webContents.once('destroyed', () => {
    trustedAppUrlsByWebContentsId.delete(webContents.id)
  })
}

export function isTrustedAppUrl(value: string): boolean {
  const normalized = normalizeTrustedAppUrl(value)
  return normalized ? trustedAppUrls.has(normalized) : false
}

export function isTrustedAppUrlForWebContents(webContentsId: number, value: string): boolean {
  const normalized = normalizeTrustedAppUrl(value)
  if (!normalized || !trustedAppUrls.has(normalized)) return false
  const scoped = trustedAppUrlsByWebContentsId.get(webContentsId)
  return !scoped || scoped.has(normalized)
}

export function isTrustedIpcEvent(event: TrustedIpcEvent): boolean {
  return (
    (isRegisteredClientSurfaceId(event.sender.id) || explicitlyTrustedWebContentsIds.has(event.sender.id)) &&
    event.senderFrame !== null &&
    isTrustedAppUrlForWebContents(event.sender.id, event.senderFrame.url)
  )
}

function normalizeTrustedAppUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.pathname = '/'
      url.search = ''
      url.hash = ''
      return url.toString()
    }
    return null
  } catch {
    return null
  }
}
