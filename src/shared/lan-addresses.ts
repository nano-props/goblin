import os from 'node:os'

export function isLanAddress(address: string): boolean {
  if (address.startsWith('10.')) return true
  if (address.startsWith('192.168.')) return true
  if (address.startsWith('169.254.')) return true
  if (address.startsWith('172.')) {
    const parts = address.split('.')
    if (parts.length < 2) return false
    const second = Number(parts[1])
    return Number.isFinite(second) && second >= 16 && second <= 31
  }
  return false
}

export function getLanAddresses(): string[] {
  const interfaces = os.networkInterfaces()
  const addresses: string[] = []
  if (!interfaces) return addresses
  for (const [, infos] of Object.entries(interfaces)) {
    if (!infos) continue
    for (const iface of infos) {
      if (iface.family === 'IPv4' && !iface.internal && isLanAddress(iface.address)) {
        addresses.push(iface.address)
      }
    }
  }
  return addresses
}

export function getLanUrls(port: number): string[] {
  return getLanAddresses().map((addr) => `http://${addr}:${port}`)
}
