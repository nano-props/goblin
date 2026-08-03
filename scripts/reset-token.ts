#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { accessTokenFilePath, removeAccessTokenFile } from '#/shared/access-token-file.ts'
import { serverDataDir } from '#/shared/data-dir.ts'

async function resetToken(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'data-dir': { type: 'string' },
    },
    strict: true,
  })
  const dataDir = values['data-dir']?.trim() || serverDataDir()
  const tokenFile = accessTokenFilePath(dataDir)
  const removed = await removeAccessTokenFile(dataDir)

  if (removed) {
    console.log(`Removed the server access token: ${tokenFile}`)
  } else {
    console.log(`No server access token exists at: ${tokenFile}`)
  }
  console.log('Restart the standalone server without --token to generate a new token and invalidate the old one.')
}

if (import.meta.main) await resetToken()
