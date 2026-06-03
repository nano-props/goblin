import path from 'node:path'

export function serverDataDir(): string {
  const explicit = process.env.GOBLIN_SERVER_DATA_DIR?.trim()
  if (explicit) return explicit
  if (process.platform === 'darwin') {
    const home = process.env.HOME?.trim()
    if (home) return path.join(home, 'Library', 'Application Support', 'Goblin')
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim()
    if (localAppData) return path.join(localAppData, 'Goblin')
    const appData = process.env.APPDATA?.trim()
    if (appData) return path.join(appData, 'Goblin')
    const userProfile = process.env.USERPROFILE?.trim()
    if (userProfile) return path.join(userProfile, 'AppData', 'Local', 'Goblin')
  }
  const xdgStateHome = process.env.XDG_STATE_HOME?.trim()
  if (xdgStateHome) return path.join(xdgStateHome, 'goblin')
  const home = process.env.HOME?.trim()
  if (home) return path.join(home, '.local', 'state', 'goblin')
  return path.join(process.cwd(), '.goblin-server')
}

export function serverDataFile(name: string): string {
  return path.join(serverDataDir(), name)
}
