export function printHelp(): void {
  console.log(`Goblin — Workspace Manager

Usage: goblin <command> [options]

Commands:
  serve                 Start the server
  open [directory]      Open a workspace in your browser (default: current directory)

Options:
  -h, --help            Show this help (also available for each command)
  -v, --version         Print the version

serve options:
  --host <host>         Bind address (default: 127.0.0.1)
  --port <port>         Listen port (default: 32100)
  --data-dir <path>     Application data directory
  --token <token>       Use an explicit access token

open options:
  --host <host>         Server address (default: 127.0.0.1)
  --port <port>         Server port (default: 32100)

Environment variables:
  GOBLIN_SERVER_HOST    Server host
  GOBLIN_SERVER_PORT    Server port`)
}
