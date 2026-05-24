import { shell } from 'electron'

export async function openHttpsExternal(url: string): Promise<boolean> {
  return openExternalUrl(url, new Set(['https:']))
}

export async function openHttpExternal(url: string): Promise<boolean> {
  return openExternalUrl(url, new Set(['https:', 'http:']))
}

async function openExternalUrl(url: string, allowedProtocols: Set<string>): Promise<boolean> {
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
