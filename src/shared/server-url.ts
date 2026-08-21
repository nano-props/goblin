export function formatServerUrl(host: string, port: number | string): string {
  const accessHost = serverAccessHost(host)
  return `http://${accessHost}:${port}`
}

function serverAccessHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '[::1]'
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`
  return host
}
