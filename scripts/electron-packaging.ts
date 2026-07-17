export const ELECTRON_SERVER_EXTRA_RESOURCES = [
  { from: 'dist/server', to: 'dist/server' },
  { from: 'dist/web', to: 'dist/web' },
  { from: 'node_modules/node-pty', to: 'node_modules/node-pty' },
] as const
