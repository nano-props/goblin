import { shell } from 'electron'

const HTTPS_PROTOCOLS = new Set(['https:'])
const HTTP_PROTOCOLS = new Set(['https:', 'http:'])

export async function openHttpsExternal(url: string): Promise<boolean> {
  return openExternalUrl(url, HTTPS_PROTOCOLS)
}

export async function openHttpExternal(url: string): Promise<boolean> {
  return openExternalUrl(url, HTTP_PROTOCOLS)
}

async function openExternalUrl(url: string, allowedProtocols: ReadonlySet<string>): Promise<boolean> {
  try {
    if (typeof url !== 'string' || url.length > 4096 || /[\0-\x1f\x7f]/.test(url)) return false
    const parsed = new URL(url)
    if (!allowedProtocols.has(parsed.protocol)) return false
    await shell.openExternal(parsed.toString())
    return true
  } catch {
    return false
  }
}
